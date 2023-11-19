import type { FastifyInstance } from '@brer/fastify'
import type { V1Pod } from '@kubernetes/client-node'
import Queue from 'fastq'

import { type WatchPhase } from '../lib/kubernetes.js'
import { handlePodEvent } from './util.js'
import { noop } from '../lib/util.js'

interface QueueItem {
  pod: V1Pod
  phase: WatchPhase
}

export default async function kubernetesWatcher(fastify: FastifyInstance) {
  const { helmsman, log } = fastify

  const queue = Queue.promise(
    ({ phase, pod }: QueueItem) => handlePodEvent(fastify, pod, phase),
    1,
  )

  // Start the queue when the server is ready
  queue.pause()

  const onEvent = (phase: WatchPhase, pod: V1Pod) => {
    log.trace({ pod: pod.metadata?.name, phase }, 'received pod event')
    queue
      .push({ phase, pod })
      .catch(err =>
        log.error({ pod: pod.metadata?.name, phase, err }, 'pod sync error'),
      )
  }

  let stop = noop

  fastify.addHook('onReady', async () => {
    stop = helmsman.watchPods(onEvent)
    queue.resume()
  })

  fastify.addHook('onClose', async () => {
    stop()

    // Empty the queue
    queue.kill()

    // wait for current jobs to close
    await queue.drained()
  })
}
