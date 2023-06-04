import type { Invocation } from '@brer/types'
import type { LogOptions, V1Pod } from '@kubernetes/client-node'
import type { FastifyInstance } from 'fastify'

import {
  failInvocation,
  handleInvocation,
  hasTimedOut,
} from '../lib/invocation.js'
import {
  downloadPodLogs,
  findPodByName,
  getContainerStatus,
  getLabelSelector,
  getPodByInvocationId,
  getPodStatus,
  getPodTemplate,
} from '../lib/kubernetes.js'
import { parseLogLines, pushLines } from '../lib/log.js'
import { decodeToken, encodeToken } from '../lib/token.js'
import { toTextLines } from '../lib/util.js'

export async function syncLivingInvocationById(
  fastify: FastifyInstance,
  invocationId: string,
  signal: AbortSignal,
) {
  const invocation = await fastify.database.invocations
    .find(invocationId)
    .unwrap()

  const status = invocation?.status
  if (
    status === 'pending' ||
    status === 'initializing' ||
    status === 'running'
  ) {
    return syncLivingInvocation(fastify, invocation!, signal)
  }
}

/**
 * "initializing", "pending", and "running" invocations
 */
async function syncLivingInvocation(
  fastify: FastifyInstance,
  invocation: Invocation,
  signal: AbortSignal,
) {
  const { kubernetes } = fastify

  if (invocation.status === 'pending') {
    await spawnInvocationPod(fastify, invocation)
  } else if (invocation.status === 'initializing') {
    if (hasTimedOut(invocation)) {
      await failAndClean(fastify, invocation, 'timed out')
    } else {
      const pod = await getPodByInvocationId(kubernetes, invocation._id)
      if (!pod) {
        await spawnInvocationPod(fastify, invocation)
      }
    }
  } else if (invocation.status === 'running') {
    const pod = await getPodByInvocationId(kubernetes, invocation._id)
    if (!pod) {
      await failAndClean(fastify, invocation, 'pod was deleted')
    } else {
      await handleLivingPod(fastify, pod, signal)
    }
  }
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
  // Invocations. If there's a conflict (wrong _rev) error, It means the
  // another controller has handled this Invocation.
  log.info({ invocationId: invocation._id }, 'handle invocation')
  invocation = await database.invocations
    .from(invocation)
    .update(doc => handleInvocation(doc, token.signature))
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

export async function reloadPodAndHandle(
  fastify: FastifyInstance,
  pod: V1Pod,
  signal: AbortSignal,
) {
  if (pod.metadata?.labels?.['brer.io/invocation-id']) {
    const reloaded = await findPodByName(
      fastify.kubernetes,
      pod!.metadata!.name!,
    )

    if (reloaded) {
      await handleLivingPod(fastify, reloaded, signal)
    } else {
      await handleDeletedPod(fastify, pod, signal)
    }
  }
}

async function handleLivingPod(
  fastify: FastifyInstance,
  pod: V1Pod,
  signal: AbortSignal,
) {
  const { database, log } = fastify

  const invocationId = pod.metadata?.labels?.['brer.io/invocation-id']
  if (!invocationId) {
    // This is not a Brer's Pod
    return
  }

  let invocation = await database.invocations.find(invocationId).unwrap()
  if (!invocation) {
    // The Invocation was deleted manually from the database (I suppose)
    return cleanKubernetes(fastify, invocationId)
  }

  if (hasTimedOut(invocation)) {
    // Pod is probably stuck at "Pending" state (ex. a secret is missing)
    return failAndClean(fastify, invocation, 'timed out')
  }

  const podOwner = isInvocationOwned(invocation, pod)
  const podStatus = getPodStatus(pod)
  const podDead = podStatus === 'Failed' || podStatus === 'Succeeded'

  if (
    podOwner &&
    podDead &&
    invocation.status !== 'completed' &&
    invocation.status !== 'failed'
  ) {
    log.debug({ invocationId }, 'pod dead unexpectedly')
    invocation = await database.invocations
      .from(invocation)
      .update(doc => failInvocation(doc, 'pod has terminated unexpectedly'))
      .unwrap()
  }

  if (!podOwner) {
    await cleanKubernetes(fastify, pod)
  } else if (
    invocation.status === 'running' ||
    invocation.status === 'completed' ||
    invocation.status === 'failed'
  ) {
    await handlePodLogs(fastify, invocationId, pod, signal)
  }
}

function isInvocationOwned(invocation: Invocation, pod: V1Pod): boolean {
  const env = pod.spec?.containers?.[0]?.env?.find(
    item => item.name === 'BRER_TOKEN',
  )
  const token = env?.value ? decodeToken(env.value) : false
  return token ? token.signature === invocation.tokenSignature : false
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
}

async function handlePodLogs(
  fastify: FastifyInstance,
  invocationId: string,
  pod: V1Pod | null,
  signal: AbortSignal,
) {
  const { database, kubernetes, log } = fastify

  log.debug({ invocationId }, 'prepare to collect logs')
  let lastLogDate = await getInitialDate(database, invocationId)
  let containerStatus = getContainerStatus(pod!)
  let done = false

  while (
    !signal.aborted &&
    !done &&
    (containerStatus === 'running' || containerStatus === 'terminated')
  ) {
    const options: LogOptions = {
      timestamps: true,
    }
    if (lastLogDate > 0) {
      options.sinceSeconds = Math.ceil((Date.now() - lastLogDate) / 1000)
    }
    if (containerStatus === 'running') {
      options.follow = true
      options.limitBytes = 1024 * 1024 // 1 MiB (bytes)
    }

    log.debug({ invocationId, pod: pod?.metadata?.name }, 'download pod logs')
    const { items, reason } = await tryToCollect(
      parseLogLines(
        toTextLines(
          downloadPodLogs(
            kubernetes.config,
            pod!.metadata!.namespace || kubernetes.namespace,
            pod!.metadata!.name!,
            pod!.spec!.containers[0].name,
            options,
            signal,
          ),
          'utf-8',
          options.limitBytes,
        ),
      ),
    )

    // remove 2 seconds for processing the response
    lastLogDate = Date.now() - 2000

    if (reason) {
      // kubernetes connection problems (I suppose)
      log.warn(
        { pod: pod?.metadata?.name, err: reason },
        'error while reading pod logs',
      )
    }

    log.debug({ invocationId, pod: pod?.metadata?.name }, 'save pod logs')
    const doc = await database.transaction(() =>
      database.invocationLogs
        .read(invocationId)
        .ensure({
          _id: invocationId,
          date: 0,
          pages: [],
          pod: pod!.metadata!.name!,
        })
        .update(doc => pushLines(doc, items, lastLogDate))
        .unwrap(),
    )

    // retrieve the last updatedAt from the database (could be updated by other controllers)
    lastLogDate = doc.date

    log.debug({ invocationId, pod: pod?.metadata?.name }, 'refresh pod status')
    pod = await findPodByName(
      kubernetes,
      pod!.metadata!.name!,
      pod?.metadata?.namespace,
    )
    containerStatus = pod ? getContainerStatus(pod) : 'unknown'
    done = containerStatus === 'terminated'
  }

  if (pod) {
    const podStatus = getPodStatus(pod)
    if (podStatus === 'Failed' || podStatus === 'Succeeded') {
      await cleanKubernetes(fastify, pod!)
    }
  }
}

/**
 * zero if not found
 */
async function getInitialDate(
  database: FastifyInstance['database'],
  invocationId: string,
): Promise<number> {
  const obj = await database.invocationLogs.find(invocationId).unwrap()
  return obj?.pages?.[0]?.date || 0
}

/**
 * Cast an async iterable to an array.
 */
async function tryToCollect<T>(iterable: AsyncIterable<T>) {
  // collected items
  const items: T[] = []

  // returned error
  let reason: any = null

  try {
    for await (const item of iterable) {
      items.push(item)
    }
  } catch (err) {
    reason = err
  }

  return {
    items,
    reason,
  }
}

export async function handleDeletedPod(
  fastify: FastifyInstance,
  pod: V1Pod,
  signal: AbortSignal,
) {
  const { database } = fastify
  const invocationId = pod.metadata?.labels?.['brer.io/invocation-id']

  if (invocationId) {
    const invocation = await database.invocations.find(invocationId).unwrap()

    if (invocation?.status === 'initializing') {
      await syncLivingInvocation(fastify, invocation, signal)
    } else if (invocation?.status === 'running') {
      await failAndClean(fastify, invocation, 'pod was deleted')
    }
  }
}

async function cleanKubernetes(
  { kubernetes, log }: FastifyInstance,
  podOrInvocationId: V1Pod | string,
) {
  try {
    if (typeof podOrInvocationId === 'string') {
      log.debug({ invocationId: podOrInvocationId }, 'delete pods')
      await kubernetes.api.CoreV1Api.deleteCollectionNamespacedPod(
        kubernetes.namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        getLabelSelector({ invocationId: podOrInvocationId }),
      )
    } else {
      log.debug({ pod: podOrInvocationId.metadata!.name! }, 'delete pod')
      await kubernetes.api.CoreV1Api.deleteNamespacedPod(
        podOrInvocationId.metadata!.name!,
        podOrInvocationId.metadata!.namespace!,
      )
    }
  } catch (err) {
    log.warn({ err }, 'error while deleting pods')
  }
}
