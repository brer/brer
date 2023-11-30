import type { FastifyInstance } from '@brer/fastify'
import { Watch, type V1Pod, type V1Secret } from '@kubernetes/client-node'
import plugin from 'fastify-plugin'

import { getFunctionSecretName } from '../lib/function.js'
import { type WatchPhase, getLabelSelector } from './kubernetes.js'

declare module 'fastify' {
  interface FastifyInstance {
    helmsman: {
      namespace: string
      createPod(template: V1Pod): Promise<V1Pod>
      deletePod(pod: V1Pod): Promise<void>
      deleteInvocationPods(invocationId: string): Promise<void>
      watchPods(fn: (phase: WatchPhase, pod: V1Pod) => void): () => void
      /**
       * Get newest Pod by its Invocation.
       */
      getPodByInvocationId(invocationId: string): Promise<V1Pod | null>
      pushFunctionSecrets(
        functionName: string,
        secrets: Record<string, string>,
      ): Promise<void>
    }
  }
}

async function helmsmanPlugin(fastify: FastifyInstance) {
  const decorator: FastifyInstance['helmsman'] = {
    namespace: fastify.kubernetes.namespace,
    createPod: createPod.bind(null, fastify),
    deletePod: deletePod.bind(null, fastify),
    deleteInvocationPods: deleteInvocationPods.bind(null, fastify),
    watchPods: watchPods.bind(null, fastify),
    getPodByInvocationId: getPodByInvocationId.bind(null, fastify),
    pushFunctionSecrets: pushFunctionSecrets.bind(null, fastify),
  }

  fastify.decorate('helmsman', decorator)
}

async function createPod(
  { kubernetes, log }: FastifyInstance,
  template: V1Pod,
) {
  log.trace('spawn new pod')
  const response = await kubernetes.api.CoreV1Api.createNamespacedPod(
    kubernetes.namespace,
    template,
  )
  return response.body
}

async function deletePod({ kubernetes, log }: FastifyInstance, pod: V1Pod) {
  const podName = pod.metadata?.name
  if (!podName) {
    throw new Error('Unnamed Pod')
  }

  try {
    log.trace(`delete ${podName} pod`)
    await kubernetes.api.CoreV1Api.deleteNamespacedPod(
      podName,
      kubernetes.namespace,
    )
  } catch (err) {
    if (Object(err).statusCode !== 404) {
      return Promise.reject(err)
    }
  }
}

async function deleteInvocationPods(
  { kubernetes, log }: FastifyInstance,
  invocationId: string,
) {
  log.trace({ invocationId }, 'delete invocation pods')
  await kubernetes.api.CoreV1Api.deleteCollectionNamespacedPod(
    kubernetes.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    getLabelSelector({ invocationId }),
  )
}

async function pushFunctionSecrets(
  { kubernetes }: FastifyInstance,
  functionName: string,
  secrets: Record<string, string>,
) {
  if (!Object.keys(secrets).length) {
    return
  }

  const secretName = getFunctionSecretName(functionName)

  const template: V1Secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'Opaque',
    metadata: {
      name: secretName,
      labels: {
        'app.kubernetes.io/managed-by': 'brer.io',
        'brer.io/function-name': functionName,
      },
    },
    stringData: secrets,
  }

  // TODO: is there a way to do this thing with one request?
  const exists = await kubernetes.api.CoreV1Api.readNamespacedSecret(
    secretName,
    kubernetes.namespace,
    undefined,
  ).catch(err =>
    err?.response?.statusCode === 404 ? null : Promise.reject(err),
  )
  if (exists) {
    await kubernetes.api.CoreV1Api.patchNamespacedSecret(
      secretName,
      kubernetes.namespace,
      template,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          'content-type': 'application/merge-patch+json',
        },
      },
    )
  } else {
    await kubernetes.api.CoreV1Api.createNamespacedSecret(
      kubernetes.namespace,
      template,
    )
  }
}

/**
 * Get the last created Pod by its Invocation identifier.
 */
export async function getPodByInvocationId(
  { kubernetes }: FastifyInstance,
  invocationId: string,
): Promise<V1Pod | null> {
  const response = await kubernetes.api.CoreV1Api.listNamespacedPod(
    kubernetes.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    getLabelSelector({ invocationId }),
  )
  if (!response.body.items.length) {
    return null
  }
  return response.body.items.reduce((a, b) => {
    if (
      a.metadata?.creationTimestamp &&
      b.metadata?.creationTimestamp &&
      a.metadata.creationTimestamp > b.metadata.creationTimestamp
    ) {
      return a
    } else {
      return b
    }
  })
}

function watchPods(
  fastify: FastifyInstance,
  handler: (phase: WatchPhase, pod: V1Pod) => void,
) {
  const { kubernetes, log } = fastify

  const watcher = new Watch(kubernetes.config)

  let closed = false
  let request: any = null

  const watchPods = () => {
    return new Promise<void>((resolve, reject) => {
      watcher
        .watch(
          `/api/v1/namespaces/${kubernetes.namespace}/pods`,
          {
            labelSelector: getLabelSelector(), // only manged-by=brer pods
          },
          (phase: string, pod: V1Pod) => {
            if (!closed) {
              handler(phase as WatchPhase, pod)
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

  process.nextTick(autoWatch)

  return () => {
    closed = true
    if (request) {
      request.destroy()
    }
  }
}

export default plugin(helmsmanPlugin, {
  name: 'helmsman',
  decorators: {
    fastify: ['kubernetes'],
  },
})
