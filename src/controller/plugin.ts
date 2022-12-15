import { V1Pod, Watch } from '@kubernetes/client-node'
import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import Queue from 'fastq'

import { failInvocation } from '../api/invocations/lib/invocation.js'
import {
  getLabelSelector,
  getPodByInvocationId,
} from '../api/invocations/lib/kubernetes.js'

interface WatchEvent {
  phase: 'ADDED' | 'MODIFIED' | 'DELETED'
  pod: V1Pod
}

function getPodId(pod: V1Pod) {
  return pod.metadata?.name || pod.metadata?.uid || 'unknown'
}

async function controllerPlugin(fastify: FastifyInstance) {
  const { database, kubernetes, log } = fastify
  log.debug('controller plugin is enabled')

  const queue = Queue.promise(watchWorker, 1)
  const watcher = new Watch(kubernetes.config)

  let closed = false
  let request: any

  async function watchWorker({ phase, pod }: WatchEvent) {
    // Detects Brer's pods
    const invocationId = pod.metadata?.labels?.['brer.io/invocation-id']

    if (invocationId) {
      switch (phase) {
        case 'ADDED':
        case 'MODIFIED':
          // "added" is NOT "created"
          // at startup all pods are "added" to this watching list
          return onPodEvent(fastify, invocationId, pod)
        case 'DELETED':
          return onPodDeletion(fastify, invocationId, pod)
        default:
          return log.warn(
            { podId: getPodId(pod), phase },
            'unexpected watch phase',
          )
      }
    }
  }

  function watchPods(exit: (err: any) => void) {
    watcher
      .watch(
        `/api/v1/namespaces/${kubernetes.namespace}/pods`,
        {
          labelSelector: getLabelSelector(), // only manged-by=brer pods
        },
        (phase: any, pod: V1Pod) => {
          const podId = getPodId(pod)
          log.info({ podId, phase }, 'watch event received')
          queue.push({ phase, pod }).then(
            () => log.info({ podId }, 'watch event consumed'),
            err => log.error({ podId, err }, 'watch event error'),
          )
        },
        exit,
      )
      .then(result => {
        // Save the current request to be aborted at the server close
        request = result
        log.debug('watching for pods events')
      })
      .then(() =>
        // Ensure that "running" invocations have their pods
        database.invocations
          .filter({ status: 'running' })
          .tap(async invocation => {
            const pod = await getPodByInvocationId(kubernetes, invocation._id!)
            if (!pod) {
              // TODO: improve fake pod
              queue.push({
                phase: 'DELETED',
                pod: {
                  metadata: {
                    labels: {
                      'brer.io/invocation-id': invocation._id!,
                    },
                  },
                },
              })
            }
          })
          .consume(),
      )
      .catch(exit)
  }

  function autoWatch() {
    watchPods(err => {
      if (!closed) {
        if (err) {
          log.error({ err }, 'an error has stopped the watcher')
        } else {
          log.warn('the watcher has stopped')
        }
        process.nextTick(autoWatch)
      }
    })
  }

  autoWatch()

  fastify.addHook('onClose', async () => {
    // Stop "auto restart" and close the current one
    closed = true
    if (request) {
      request.destroy()
    }

    // Removes all tasks waiting to be processed (unacked messages will be recovered later)
    queue.kill()

    // Wait for processing tasks
    if (!queue.idle()) {
      log.info('drain watch events')
      await queue.drained()
    }
  })
}

type PodStatus = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown'

async function onPodEvent(
  { database, kubernetes, log }: FastifyInstance,
  invocationId: string,
  pod: V1Pod,
) {
  const invocation = await database.invocations.find(invocationId).unwrap()

  if (!invocation) {
    log.debug({ invocationId }, 'delete pod without invocation')
    return kubernetes.api.CoreV1Api.deleteNamespacedPod(
      pod.metadata?.name!,
      kubernetes.namespace,
    )
  }

  const failure = database.invocations
    .from(invocation)
    .update(doc => failInvocation(doc, 'unhandled exit'))

  const podStatus = pod.status?.phase as PodStatus

  if (invocation.status === 'initializing' || invocation.status === 'running') {
    // The invocation is alive
    if (podStatus === 'Succeeded' || podStatus === 'Failed') {
      // The pod has completed its task, but the Invocation didn't receive any result, this is a failure
      await failure.unwrap()
    }
  }
}

async function onPodDeletion(
  { database }: FastifyInstance,
  invocationId: string,
  pod: V1Pod,
) {
  await database.invocations
    .find(invocationId)
    .filter(doc => doc.status !== 'completed' && doc.status !== 'failed')
    .update(doc => failInvocation(doc, `pod ${getPodId(pod)} was deleted`))
    .unwrap()
}

export default plugin(controllerPlugin, {
  name: 'controller',
  decorators: {
    fastify: ['database', 'kubernetes'],
  },
})
