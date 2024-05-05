import type { FastifyInstance } from '@brer/fastify'
import { Watch } from '@kubernetes/client-node'
import plugin from 'fastify-plugin'

import {
  getActiveInvocationIds,
  getPodInvocationId,
  reconcileByInvocationId,
} from './reconcile.js'

export interface PluginOptions {
  invokerUrl: URL
}

async function controllerPlugin(
  fastify: FastifyInstance,
  { invokerUrl }: PluginOptions,
) {
  const { events, kubernetes, log } = fastify

  const watcher = new Watch(kubernetes.config)

  // Watcher's request object
  let request: any

  // Queued Invocations' identifiers
  const queue: string[] = []

  // Number of reconciliation attempts done for a single Inovocation
  let attempts = 0

  // Server is closing
  let closed = false

  // Current queue process
  let promise: Promise<void> = Promise.resolve()

  const worker = async () => {
    while (!closed && queue.length > 0) {
      const invocationId = queue[0]

      attempts++
      try {
        await reconcileByInvocationId(fastify, invokerUrl, invocationId)
        attempts = 0
        queue.shift()
      } catch (err) {
        log.error(
          { invocationId, attempts, err },
          'error during the reconciliation',
        )
      }
    }
  }

  const push = (invocationId: string) => {
    if (!closed) {
      if (queue.push(invocationId) === 1) {
        promise = worker()
      }
    }
  }

  const watchPods = async (done: (err: any) => void) => {
    request = await watcher.watch(
      `/api/v1/namespaces/${kubernetes.namespace}/pods`,
      { labelSelector: 'app.kubernetes.io/managed-by=brer.io' },
      (phase: any, pod: any) => {
        if (!closed) {
          const invocationId = getPodInvocationId(pod)
          if (!invocationId) {
            log.warn({ podName: pod.metadata.name }, 'found an extraneous pod')
          } else {
            push(invocationId)
          }
        }
      },
      done,
    )
  }

  const keepWatching = () => {
    const callback = (err: unknown) => {
      if (!closed) {
        log.warn({ err }, 'pods watcher has been closed')
        process.nextTick(keepWatching)
      }
    }

    watchPods(callback).catch(callback)
  }

  const spawnAll = async () => {
    if (!closed) {
      const invocationIds = await getActiveInvocationIds(fastify)
      for (const invocationId of invocationIds) {
        push(invocationId)
      }
    }
  }

  fastify.addHook('onReady', async () => {
    log.debug('watch pods')
    await watchPods(err => {
      log.warn({ err }, 'pods watcher has been closed')
      process.nextTick(keepWatching)
    })

    log.debug('initialize pending invocations')
    await spawnAll()
  })

  events
    .on('brer.io/invocations/created', push)
    .on('brer.io/invocations/updated', push)
    .on('brer.io/invocations/deleted', push)

  events.on('brer.io/invocations/died', () =>
    spawnAll().catch(err =>
      log.error({ err }, "couldn't spawn next invocations"),
    ),
  )

  fastify.addHook('onClose', async () => {
    // Prevent new events to be pushed
    closed = true

    // Close current watch request
    if (request) {
      request.destroy()
    }

    // Wait for queue to be drained
    await promise
  })
}

export default plugin(controllerPlugin, {
  decorators: {
    fastify: ['events', 'kubernetes'],
  },
})
