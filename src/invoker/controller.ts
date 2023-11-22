import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import type { V1Pod } from '@kubernetes/client-node'
import Queue from 'fastq'

import { type WatchPhase, getPodStatus } from '../lib/kubernetes.js'
import { noop } from '../lib/util.js'
import { failWithReason } from './lib.js'

interface QueueItem {
  pod: V1Pod
  phase: WatchPhase
}

export default async function controllerPlugin(fastify: FastifyInstance) {
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

    // TODO: retry after X seconds on error?
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

async function handlePodEvent(
  fastify: FastifyInstance,
  pod: V1Pod,
  phase: WatchPhase,
) {
  const invocationId = pod.metadata?.labels?.['brer.io/invocation-id']
  if (!invocationId) {
    // Not managed by Brer, just ignore
    return
  }

  const { helmsman, store } = fastify

  const invocation = await store.invocations.find(invocationId).unwrap()
  let deletePod = false

  if (phase === 'DELETED') {
    if (
      invocation &&
      invocation.status !== 'completed' &&
      invocation.status !== 'failed'
    ) {
      // Pod was manually deleted (fail its Invocation)
      await failWithReason(fastify, invocation, 'pod deletion')
    }
  } else {
    deletePod = shouldDeletePod(pod, invocation)
  }

  if (deletePod) {
    await helmsman.deletePod(pod)
  }
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
