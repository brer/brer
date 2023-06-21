import { V1Pod, Watch } from '@kubernetes/client-node'
import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'
import { hostname } from 'node:os'

import { getLabelSelector } from '../lib/kubernetes.js'
import { getRandomInt } from '../lib/util.js'
import rpcPlugin from './rpc.js'
import { syncInvocationById } from './sync.js'

async function controllerPlugin(fastify: FastifyInstance) {
  const { database, kubernetes, log } = fastify

  let fieldSelector: string | undefined
  if (process.env.KUBERNETES_SERVICE_HOST) {
    const thisPod = await kubernetes.api.CoreV1Api.readNamespacedPod(
      hostname(),
      kubernetes.namespace,
    )
    if (
      thisPod.body.metadata?.ownerReferences?.find(
        item => item.kind === 'DaemonSet',
      ) &&
      thisPod.body.spec?.nodeName
    ) {
      fieldSelector = `spec.nodeName=${thisPod.body.spec.nodeName}`
      log.debug({ nodeName: thisPod.body.spec.nodeName }, 'daemonset detected')
    }
  }

  const map: Map<string, Promise<any>> = new Map()
  const watcher = new Watch(kubernetes.config)

  let closed = false
  let request: any = null
  let timer: any = null

  const pushJob = (invocationId: string) => {
    if (closed) {
      // server is closing
      return
    }
    if (map.has(invocationId)) {
      log.trace({ invocationId }, 'invocation job is running')
      return
    }

    const promise = syncInvocationById(fastify, invocationId)
      .catch(err => {
        log.error({ invocationId, err }, 'error while watching invocation')
      })
      .then(() => {
        log.trace({ invocationId }, 'pull invocation job')
        map.delete(invocationId)
      })

    log.trace({ invocationId }, 'push invocation job')
    map.set(invocationId, promise)
  }

  fastify.register(rpcPlugin, {
    callback: invocation => pushJob(invocation._id),
  })

  const watchPods = () => {
    return new Promise<void>((resolve, reject) => {
      watcher
        .watch(
          `/api/v1/namespaces/${kubernetes.namespace}/pods`,
          {
            fieldSelector, // this node pods
            labelSelector: getLabelSelector(), // only manged-by=brer pods
          },
          (phase: string, pod: V1Pod) => {
            const invocationId = pod.metadata?.labels?.['brer.io/invocation-id']
            if (invocationId) {
              log.trace({ invocationId, phase }, 'received kubernetes event')
              pushJob(invocationId)
            }
          },
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

    let running = false
    timer = setInterval(() => {
      if (running) {
        // this could be an query optimization problem
        return log.warn('sync living invocations is still running')
      }

      log.trace('sync living invocations')
      running = true
      database.invocations
        .filter({
          status: {
            $in: ['pending', 'initializing', 'running'],
          },
        })
        .tap(invocation => pushJob(invocation._id))
        .consume()
        .catch(err => {
          log.error({ err }, 'failed to sync invocations status')
        })
        .then(() => {
          running = false
        })
    }, getRandomInt(60000, 300000))
  })

  fastify.addHook('onClose', async () => {
    closed = true

    if (request) {
      request.destroy()
    }
    if (timer) {
      clearInterval(timer)
    }

    // wait for current jobs to close
    await Promise.allSettled(map.values())
  })
}

export default plugin(controllerPlugin, {
  name: 'controller',
  decorators: {
    fastify: ['database', 'kubernetes'],
  },
  encapsulate: true,
})
