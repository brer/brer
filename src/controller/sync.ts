import type { Invocation } from '@brer/types'
import type { LogOptions } from '@kubernetes/client-node'
import type { FastifyInstance } from 'fastify'

import {
  failInvocation,
  handleInvocation,
  hasTimedOut,
} from '../lib/invocation.js'
import {
  ContainerStatus,
  downloadPodLogs,
  findPodByName,
  getContainerStatus,
  getLabelSelector,
  getPodByInvocationId,
  getPodStatus,
  getPodTemplate,
} from '../lib/kubernetes.js'
import { parseLogLines, pushLines } from '../lib/log.js'
import { encodeToken } from '../lib/token.js'
import { toTextLines } from '../lib/util.js'

export async function syncInvocationById(
  fastify: FastifyInstance,
  invocationId: string,
): Promise<Invocation | null> {
  const { database, kubernetes, log } = fastify

  let invocation = await database.invocations.find(invocationId).unwrap()
  if (!invocation) {
    await cleanKubernetes(fastify, invocationId)
    return null
  }

  if (invocation.status === 'pending') {
    // TODO: this is the step that needs to be throttled (max running executions per cluster)
    log.info({ invocationId: invocation._id }, 'handle invocation')
    invocation = await database.invocations
      .from(invocation)
      .update(handleInvocation)
      .unwrap()
  }

  if (invocation.status === 'initializing') {
    if (!invocation.tokenSignature) {
      // First clean run (no tokens were generated)
      invocation = await spawnInvocationPod(fastify, invocation)
    } else if (hasTimedOut(invocation)) {
      // Stuck inside Kubernetes somehow (ex missing secret)
      invocation = await failAndClean(fastify, invocation, 'timed out')
    } else {
      const pod = await getPodByInvocationId(kubernetes, invocation._id)
      if (!pod) {
        // Previous iteration of this code has failed to create the Pod
        invocation = await spawnInvocationPod(fastify, invocation)
      }
    }

    // Wait for Pod to ping the controller
    return invocation
  }

  return collectPodLogsAndSync(fastify, invocation)
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

async function collectPodLogsAndSync(
  fastify: FastifyInstance,
  sourceInvocation: Invocation,
): Promise<Invocation> {
  const { database, kubernetes, log } = fastify
  const invocationId = sourceInvocation._id

  let invocation: Invocation | null = sourceInvocation
  let [pod, lastLogDate] = await Promise.all([
    getPodByInvocationId(kubernetes, invocationId),
    getInitialDate(database, invocationId),
  ])

  let containerStatus: ContainerStatus = pod
    ? getContainerStatus(pod)
    : 'unknown'

  let hasLogs =
    containerStatus === 'running' || containerStatus === 'terminated'

  while (invocation && pod && hasLogs) {
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

    // Reload entities status
    const result = await Promise.all([
      database.invocations.find(invocation._id).unwrap(),
      findPodByName(kubernetes, pod!.metadata!.name!, pod!.metadata!.namespace),
    ])
    invocation = result[0]
    pod = result[1]
    containerStatus = pod ? getContainerStatus(pod) : 'terminated'
    hasLogs = containerStatus === 'running'

    // Update "last invocation state" if necessary
    if (invocation) {
      sourceInvocation = invocation
    }
  }

  if (!invocation) {
    // Invocation was deleted
    await cleanKubernetes(fastify, invocationId)
    return sourceInvocation
  }

  const podStatus = pod ? getPodStatus(pod) : 'Failed'

  if (
    (podStatus === 'Failed' || podStatus === 'Succeeded') &&
    invocation.status === 'running'
  ) {
    // Pod was (manually) deleted or the Pod coudn't communicate with the controller
    invocation = await failAndClean(
      fastify,
      invocation,
      pod ? 'pod was deleted' : 'pod has terminated unexpectedly',
    )
  } else if (
    invocation.status === 'completed' ||
    invocation.status === 'failed'
  ) {
    await cleanKubernetes(fastify, invocationId)
  }

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
