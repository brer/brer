import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import type { V1Pod } from '@kubernetes/client-node'

import { getFunctionByName, setFunctionRuntime } from '../lib/function.js'
import { isSameImage } from '../lib/image.js'
import {
  failInvocation,
  handleInvocation,
  hasTimedOut,
  isTestRun,
  setTokenSignature,
} from '../lib/invocation.js'
import {
  type WatchPhase,
  getPodByInvocationId,
  getPodStatus,
  getPodTemplate,
} from '../lib/kubernetes.js'
import { type InvocationToken, encodeToken } from '../lib/token.js'

/**
 * Kubernetes Controller loop handler.
 */
export async function handlePodEvent(
  fastify: FastifyInstance,
  pod: V1Pod,
  phase: WatchPhase,
): Promise<Invocation | null> {
  const invocationId = pod.metadata?.labels?.['brer.io/invocation-id']
  if (!invocationId) {
    // Not managed by Brer, just ignore
    return null
  }

  const { kubernetes, log, store } = fastify

  let invocation = await store.invocations.find(invocationId).unwrap()
  let deletePod = false

  if (phase === 'DELETED') {
    if (
      invocation &&
      invocation.status !== 'completed' &&
      invocation.status !== 'failed'
    ) {
      // Pod was manually deleted (fail its Invocation)
      invocation = await failWithMessage(fastify, invocation, 'pod deletion')
    }
  } else {
    deletePod = shouldDeletePod(pod, invocation)
  }

  if (deletePod) {
    log.debug(`delete pod ${pod.metadata?.name}`)
    try {
      await kubernetes.api.CoreV1Api.deleteNamespacedPod(
        pod.metadata!.name!,
        kubernetes.namespace,
      )
    } catch (err) {
      if (Object(err).statusCode !== 404) {
        // Pod was previously deleted
        return Promise.reject(err)
      }
    }
  }

  return invocation
}

function shouldDeletePod(pod: V1Pod, invocation: Invocation | null): boolean {
  if (
    invocation &&
    (invocation.status === 'completed' || invocation.status === 'failed') &&
    getPodStatus(pod) === 'Succeeded'
  ) {
    // Both Invocation and Pod closed correctly
    return true
  } else {
    // Debug needed :)
    return false
  }
}

/**
 * Instantly spawns a `"pending"` Invocation.
 */
export async function handleInvokeEvent(
  fastify: FastifyInstance,
  invocation: Invocation,
): Promise<Invocation> {
  const { log, store } = fastify
  const token = encodeToken(invocation._id)

  log.debug({ invocationId: invocation._id }, 'handle invocation')
  invocation = await store.invocations
    .from(invocation)
    .update(handleInvocation)
    .update(doc => setTokenSignature(doc, token.signature))
    .unwrap()

  await spawnInvocationPod(fastify, invocation, token)

  return invocation
}

/**
 * Invocation watchdog handler.
 */
export async function syncInvocationState(
  fastify: FastifyInstance,
  invocation: Invocation,
): Promise<Invocation> {
  const { kubernetes } = fastify

  if (invocation.status === 'pending') {
    // Invoke event was lost
    invocation = await handleInvokeEvent(fastify, invocation)
  } else if (invocation.status === 'initializing') {
    if (hasTimedOut(invocation)) {
      // Stuck inside Kubernetes somehow (ex. missing secret)
      invocation = await failWithMessage(fastify, invocation, 'timed out')
    } else {
      const pod = await getPodByInvocationId(kubernetes, invocation._id)
      const podStatus = pod ? getPodStatus(pod) : 'Failed'
      if (!pod) {
        // Previous Pod spawn failed
        invocation = await recoverInvocationPod(fastify, invocation)
      } else if (podStatus === 'Failed' || podStatus === 'Succeeded') {
        // Pod has completed without notification
        invocation = await failWithMessage(
          fastify,
          invocation,
          podStatus === 'Succeeded' ? 'early termination' : 'runtime failure',
        )
      }
    }
  } else if (invocation.status === 'running') {
    const pod = await getPodByInvocationId(kubernetes, invocation._id)
    const podStatus = pod ? getPodStatus(pod) : 'Failed'

    if (podStatus === 'Failed' || podStatus === 'Succeeded') {
      invocation = await failWithMessage(
        fastify,
        invocation,
        !pod
          ? 'pod deletion'
          : podStatus === 'Succeeded'
            ? 'early termination'
            : 'runtime failure',
      )
    }
  }

  return invocation
}

export async function spawnInvocationPod(
  { kubernetes, log }: FastifyInstance,
  invocation: Invocation,
  token: InvocationToken,
) {
  if (invocation.tokenSignature !== token.signature) {
    throw new Error(
      `Inovcation ${invocation._id} has an invalid token signature`,
    )
  }

  log.debug({ invocationId: invocation._id }, 'spawn invocation pod')
  await kubernetes.api.CoreV1Api.createNamespacedPod(
    kubernetes.namespace,
    getPodTemplate(
      invocation,
      process.env.RPC_URL ||
        `http://brer-controller.${kubernetes.namespace}.svc.cluster.local/`,
      token.value,
    ),
  )
}

export async function recoverInvocationPod(
  fastify: FastifyInstance,
  invocation: Invocation,
) {
  const { log, store } = fastify

  // The token signature will be saved inside the Invocation.
  // Even if multiple Pods are spawned, only the one with the correct token will
  // be able to consume the Invocation.
  const token = encodeToken(invocation._id)

  // No transaction here. The controller is the only process that updates
  // Invocations. If there's a conflict (wrong _rev) error, It means that
  // another controller has handled this Invocation.
  log.debug({ invocationId: invocation._id }, 'recover invocation')
  invocation = await store.invocations
    .from(invocation)
    .update(doc => setTokenSignature(doc, token.signature))
    .unwrap()

  await spawnInvocationPod(fastify, invocation, token)

  return invocation
}

export async function failWithMessage(
  fastify: FastifyInstance,
  invocation: Invocation,
  message: string,
) {
  const { log, store } = fastify

  log.debug({ invocationId: invocation._id }, message)
  invocation = await store.invocations
    .from(invocation)
    .update(doc => failInvocation(doc, message))
    .tap(doc => handleTestInvocation(store, doc))
    .unwrap()

  await rotateInvocations(fastify, invocation.functionName)

  return invocation
}

export async function handleTestInvocation(
  store: FastifyInstance['store'],
  invocation: Invocation,
) {
  if (
    isTestRun(invocation) &&
    (invocation.status === 'completed' || invocation.status === 'failed')
  ) {
    await store.functions
      .from(asIterable(store, invocation))
      .filter(fn => isSameImage(invocation.image, fn.image))
      .update(fn => setFunctionRuntime(fn, invocation))
      .unwrap()
  }
}

async function* asIterable(
  store: FastifyInstance['store'],
  invocation: Invocation,
) {
  const fn = await getFunctionByName(store, invocation.functionName)
  if (fn) {
    yield fn
  }
}

export async function rotateInvocations(
  { log, store }: FastifyInstance,
  fnName: string,
) {
  const fn = await getFunctionByName(store, fnName)
  if (fn) {
    log.debug({ functionName: fnName }, 'rotate invocations')
    return store.invocations
      .filter({
        _design: 'default',
        _view: 'dead',
        startkey: [fnName, {}],
        endkey: [fnName, null],
      })
      .delete()
      .consume({
        descending: true,
        purge: true,
        skip: fn.historyLimit || 10,
      })
  }
}
