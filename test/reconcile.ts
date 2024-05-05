import test from 'ava'
import { Store } from 'mutent'

import { reconcileByInvocationId } from '../src/invoker/reconcile.js'

function noop() {
  // nothing to do
}

test('purge orphan pods', async t => {
  t.plan(6)

  const fastify: any = {
    kubernetes: {
      api: {
        CoreV1Api: {},
      },
      namespace: 'test-namespace',
    },
    log: {
      debug: noop,
    },
    store: {},
  }

  fastify.store.invocations = new Store({
    adapter: {
      find(query) {
        t.is(query, 'test-invocation')
        return null
      },
    },
  })

  fastify.kubernetes.api.CoreV1Api.listNamespacedPod = async () => ({
    body: {
      items: [
        {
          metadata: {
            name: 'orphan-pod',
            finalizers: ['brer.io/invocation-protection'],
          },
        },
      ],
    },
  })

  fastify.kubernetes.api.CoreV1Api.patchNamespacedPod = async (
    name: string,
    namespace: string,
    body: object,
  ) => {
    t.is(name, 'orphan-pod')
    t.is(namespace, 'test-namespace')
    t.like(body, [
      {
        op: 'test',
        path: '/metadata/finalizers/0',
        value: 'brer.io/invocation-protection',
      },
      {
        op: 'remove',
        path: '/metadata/finalizers/0',
      },
    ])
  }

  fastify.kubernetes.api.CoreV1Api.deleteNamespacedPod = async (
    name: string,
    namespace: string,
  ) => {
    t.is(name, 'orphan-pod')
    t.is(namespace, 'test-namespace')
  }

  const invokerUrl = new URL('http://127.0.0.1:3000')

  await reconcileByInvocationId(fastify, invokerUrl, 'test-invocation')
})
