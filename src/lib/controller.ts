import type { CouchGenerics, Invocation } from '@brer/types'
import { V1Pod, Watch } from '@kubernetes/client-node'
import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import Queue from 'fastq'
import * as Mutent from 'mutent'

import {
  completeInvocation,
  failInvocation,
} from '../api/invocations/lib/invocation.js'
import { getPodByInvocationId } from '../api/invocations/lib/kubernetes.js'

interface WatchEvent {
  phase: 'ADDED' | 'MODIFIED' | 'DELETED'
  resource: V1Pod
}

async function controllerPlugin(fastify: FastifyInstance) {
  const { database, kubernetes, log } = fastify

  const queue = Queue.promise(watchWorker, 1)
  const watcher = new Watch(kubernetes.config)

  let closed = false
  let request: any

  async function watchWorker({ phase, resource }: WatchEvent) {
    // Detects Brer's pods
    const invocationId = resource.metadata?.labels?.['brer.io/invocation-id']

    if (invocationId) {
      switch (phase) {
        case 'ADDED':
        case 'MODIFIED':
          // "added" is NOT "created"
          // at startup all pods are "added" to this watching list
          return onPodEvent(fastify, invocationId, resource)
        case 'DELETED':
          return onPodDeletion(fastify, invocationId)
        default:
          return log.warn({ phase, resource }, 'unkown watch phase')
      }
    }
  }

  function watchPods(exit: (err: any) => void) {
    watcher
      .watch(
        `/api/v1/namespaces/${kubernetes.namespace}/pods`,
        {},
        (phase: any, resource) => {
          log.trace({ phase, resource }, 'watch event received')
          queue
            .push({ phase, resource })
            .catch(err => log.error({ err }, 'error while watching'))
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
                resource: {
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
        setTimeout(autoWatch, 1000)
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
      log.debug('waiting for remained watch events')
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

  // List of wanted mutations to apply to the current invocation
  const mutators: Array<Mutent.Mutator<CouchGenerics<Invocation>>> = []

  const podStatus = pod.status?.phase as PodStatus
  if (invocation.status === 'initializing') {
    // Pod is starting (no user code is executed)
    if (podStatus !== 'Pending' && podStatus !== 'Running') {
      // The pod status is "already" in the future somehow
      log.debug({ invocationId }, 'pod has failed before startup')
      mutators.push(Mutent.update(doc => failInvocation(doc)))
    }
  } else if (invocation.status === 'running') {
    // Invocation has started (payload fetched and code is ready)
    if (podStatus === 'Succeeded') {
      log.debug({ invocationId }, 'pod has succeeded')
      mutators.push(Mutent.update(doc => completeInvocation(doc)))
    } else if (podStatus === 'Failed' || podStatus === 'Unknown') {
      log.debug({ invocationId }, 'pod has failed')
      mutators.push(Mutent.update(doc => failInvocation(doc)))
    }
  }

  if (mutators.length > 0) {
    await database.invocations
      .from(invocation)
      .pipe(...mutators)
      .unwrap()
  }
}

async function onPodDeletion(
  { database }: FastifyInstance,
  invocationId: string,
) {
  await database.invocations
    .find(invocationId)
    .filter(doc => doc.status !== 'failed') // avoid update if already failed
    .update(failInvocation)
    .unwrap()
}

export default plugin(controllerPlugin, {
  name: 'controller',
  decorators: {
    fastify: ['database', 'kubernetes'],
  },
})
