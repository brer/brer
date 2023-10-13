import type { FastifyInstance, Invocation } from '@brer/types'

import {
  failInvocation,
  handleInvocation,
  hasTimedOut,
} from '../lib/invocation.js'
import {
  getLabelSelector,
  getPodByInvocationId,
  getPodStatus,
  getPodTemplate,
} from '../lib/kubernetes.js'
import { encodeToken } from '../lib/token.js'

export async function syncInvocationById(
  fastify: FastifyInstance,
  invocationId: string,
): Promise<Invocation | null> {
  const { database, kubernetes, log } = fastify

  let invocation = await database.invocations.find(invocationId).unwrap()
  if (
    !invocation ||
    invocation.status === 'completed' ||
    invocation.status === 'failed'
  ) {
    // Invocation is dead or missing
    await cleanKubernetes(fastify, invocationId)
    return null
  }

  if (invocation.status === 'pending') {
    // Initialize Invocation or keep waiting
    // TODO: this is the step that needs to be throttled (max running executions per cluster)
    log.info({ invocationId: invocation._id }, 'handle invocation')
    invocation = await database.invocations
      .from(invocation)
      .update(handleInvocation)
      .unwrap()
  }

  if (invocation.status === 'initializing') {
    if (hasTimedOut(invocation)) {
      // Stuck inside Kubernetes somehow (ex missing secret)
      invocation = await failAndClean(fastify, invocation, 'timed out')
    } else {
      const pod = await getPodByInvocationId(kubernetes, invocation._id)
      if (!pod) {
        // First clean run or previous Pod creation failure
        invocation = await spawnInvocationPod(fastify, invocation)
      }
    }
  }

  if (invocation.status === 'running') {
    const pod = await getPodByInvocationId(kubernetes, invocationId)
    const podStatus = pod ? getPodStatus(pod) : 'Failed'

    if (podStatus === 'Failed' || podStatus === 'Succeeded') {
      // Pod was (manually) deleted or the Pod coudn't communicate with the controller
      invocation = await failAndClean(
        fastify,
        invocation,
        pod ? 'pod has terminated unexpectedly' : 'pod was deleted',
      )
    }
  }

  // Keep waiting for something to change inside the cluster
  return invocation
}

async function spawnInvocationPod(
  { database, kubernetes, log }: FastifyInstance,
  invocation: Invocation,
) {
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
    .assign({ tokenSignature: token.signature })
    .unwrap()

  const url =
    process.env.PUBLIC_URL ||
    `http://brer-controller.${kubernetes.namespace}.svc.cluster.local/`

  log.debug({ invocationId: invocation._id }, 'spawn invocation pod')
  await kubernetes.api.CoreV1Api.createNamespacedPod(
    kubernetes.namespace,
    getPodTemplate(invocation, url, token.value),
  )

  return invocation
}

async function failAndClean(
  fastify: FastifyInstance,
  invocation: Invocation,
  message: string,
) {
  const { database, log } = fastify

  log.debug({ invocationId: invocation._id }, message)
  invocation = await database.invocations
    .from(invocation)
    .update(doc => failInvocation(doc, message))
    .unwrap()

  await cleanKubernetes(fastify, invocation._id)

  return invocation
}

async function cleanKubernetes(
  { kubernetes, log }: FastifyInstance,
  invocationId: string,
) {
  try {
    log.debug({ invocationId }, 'delete pods')
    await kubernetes.api.CoreV1Api.deleteCollectionNamespacedPod(
      kubernetes.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      getLabelSelector({ invocationId }),
    )
  } catch (err) {
    log.warn({ err }, 'error while deleting pods')
  }
}
