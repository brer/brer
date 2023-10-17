import type { FastifyInstance } from '@brer/types'
import { V1Pod, Watch } from '@kubernetes/client-node'
import Queue from 'fastq'

import { getLabelSelector } from '../lib/kubernetes.js'
import { handlePodEvent } from './util.js'

interface QueueItem {
  pod: V1Pod
  phase: string
}

export default async function kubernetesWatcher(fastify: FastifyInstance) {
  const { kubernetes, log } = fastify

  const watcher = new Watch(kubernetes.config)

  let closed = false
  let request: any = null

  const queue = Queue.promise(
    ({ phase, pod }: QueueItem) => handlePodEvent(fastify, pod, phase),
    1,
  )

  // Start the queue when the server is ready
  queue.pause()

  const watchPods = () => {
    return new Promise<void>((resolve, reject) => {
      watcher
        .watch(
          `/api/v1/namespaces/${kubernetes.namespace}/pods`,
          {
            labelSelector: getLabelSelector(), // only manged-by=brer pods
          },
          (phase: string, pod: V1Pod) =>
            queue
              .push({ phase, pod })
              .catch(err =>
                log.error(
                  { pod: pod.metadata?.name, phase, err },
                  'pod sync error',
                ),
              ),
          err => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          },
        )
        .then(result => {
          // Save the current request to be aborted at the server close
          request = result
        }, reject)
    })
  }

  const autoWatch = () => {
    watchPods().then(
      () => {
        if (!closed) {
          log.warn('pods watcher has been closed')
          process.nextTick(autoWatch)
        } else {
          log.debug('pods watch closed')
        }
      },
      err => {
        if (!closed) {
          log.error({ err }, 'pods watcher has failed')
          process.nextTick(autoWatch)
        } else {
          log.debug('pods watch closed')
        }
      },
    )
  }

  fastify.addHook('onReady', async () => {
    autoWatch()
    queue.resume()
  })

  fastify.addHook('onClose', async () => {
    closed = true

    if (request) {
      request.destroy()
    }

    // Empty the queue
    queue.kill()

    // wait for current jobs to close
    await queue.drained()
  })
}
