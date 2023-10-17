import type { FastifyInstance, Invocation } from '@brer/types'
import type { V1Pod } from '@kubernetes/client-node'

import {
  failInvocation,
  handleInvocation,
  hasTimedOut,
  isTestRun,
  setTokenSignature,
} from '../lib/invocation.js'
import {
  getPodByInvocationId,
  getPodStatus,
  getPodTemplate,
} from '../lib/kubernetes.js'
import { InvocationToken, encodeToken } from '../lib/token.js'
import { getFunctionId, setFunctionRuntime } from '../lib/function.js'

/**
 * Kubernetes Controller loop handler.
 */
export async function handlePodEvent(
  fastify: FastifyInstance,
  pod: V1Pod,
  phase: string,
): Promise<Invocation | null> {
  const invocationId = pod.metadata?.labels?.['brer.io/invocation-id']
  if (!invocationId) {
    // Not managed by Brer, just ignore
    return null
  }

  const { database, kubernetes } = fastify

  let invocation = await database.invocations.find(invocationId).unwrap()
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
    await kubernetes.api.CoreV1Api.deleteNamespacedPod(
      pod.metadata!.name!,
      kubernetes.namespace,
    )
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
  const token = encodeToken(invocation._id)

  invocation = await fastify.database.invocations
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
          'early termination',
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
        pod ? 'early termination' : 'pod deletion',
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
      `http://brer-controller.${kubernetes.namespace}.svc.cluster.local/`,
      token.value,
    ),
  )
}

export async function recoverInvocationPod(
  fastify: FastifyInstance,
  invocation: Invocation,
) {
  const { database, log } = fastify

  // The token signature will be saved inside the Invocation.
  // Even if multiple Pods are spawned, only the one with the correct token will
  // be able to consume the Invocation.
  const token = encodeToken(invocation._id)

  // No transaction here. The controller is the only process that updates
  // Invocations. If there's a conflict (wrong _rev) error, It means that
  // another controller has handled this Invocation.
  log.info({ invocationId: invocation._id }, 'handle invocation')
  invocation = await database.invocations
    .from(invocation)
    .update(doc => setTokenSignature(doc, token.signature))
    .unwrap()

  await spawnInvocationPod(fastify, invocation, token)

  return invocation
}

export async function failWithMessage(
  { database, log }: FastifyInstance,
  invocation: Invocation,
  message: string,
) {
  log.debug({ invocationId: invocation._id }, message)
  return database.invocations
    .from(invocation)
    .update(doc => failInvocation(doc, message))
    .tap(doc => handleTestInvocation(database, doc))
    .unwrap()
}

export async function handleTestInvocation(
  database: FastifyInstance['database'],
  invocation: Invocation,
) {
  if (
    isTestRun(invocation) &&
    (invocation.status === 'completed' || invocation.status === 'failed')
  ) {
    await database.functions
      .find(getFunctionId(invocation.functionName))
      .filter(fn => fn.image === invocation.image)
      .update(fn => setFunctionRuntime(fn, invocation))
      .unwrap()
  }
}
