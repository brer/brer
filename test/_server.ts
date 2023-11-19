import type { FastifyInstance } from '@brer/fastify'
import Fastify from 'fastify'
import noAdditionalProperties from 'fastify-no-additional-properties'
import { v4 as uuid } from 'uuid'

import auth from '../src/lib/auth.js'
import error from '../src/lib/error.js'
import { handleInvocation, setTokenSignature } from '../src/lib/invocation.js'
import store from '../src/lib/store.js'
import { noop } from '../src/lib/util.js'

import api from '../src/api/plugin.js'
import controller from '../src/controller/plugin.js'

/**
 * See `package.json` for test envs.
 */
export default function createTestServer() {
  const fastify = Fastify.default({
    ajv: {
      customOptions: {
        allErrors: true,
        coerceTypes: false,
        removeAdditional: true,
        useDefaults: true,
      },
    },
    bodyLimit: 2097152, // 2 MiB (bytes)
    caseSensitive: true,
    ignoreTrailingSlash: false,
    logger: {
      level: 'error',
    },
  })

  // Just a random password
  const adminPassword = uuid()

  // Authorization header
  const authorization =
    'Basic ' + Buffer.from(`admin:${adminPassword}`).toString('base64')

  fastify.register(error)
  fastify.register(noAdditionalProperties.default)
  fastify.register(auth, { adminPassword })

  fastify.decorate('kubernetes', {
    getter() {
      throw new Error('Kubernetes plugin not available')
    },
  })

  const asyncNoop = () => Promise.resolve()
  const helmsman: FastifyInstance['helmsman'] = {
    namespace: 'default',
    createPod: pod => Promise.resolve(pod),
    deleteInvocationPods: asyncNoop,
    deletePod: asyncNoop,
    getPodByInvocationId: () => Promise.resolve(null),
    invoke: invocation =>
      fastify.store.invocations
        .from(invocation)
        .update(handleInvocation)
        .update(doc => setTokenSignature(doc, 'test'))
        .unwrap(),
    pushFunctionSecrets: asyncNoop,
    watchPods: () => noop,
  }

  fastify.decorate('helmsman', helmsman)

  fastify.decorate('tasks', {
    getter() {
      throw new Error('Tasks plugin not available')
    },
  })

  fastify.register(store, {
    url: process.env.COUCHDB_URL,
    username: process.env.COUCHDB_USERNAME,
    password: process.env.COUCHDB_PASSWORD,
  })

  fastify.register(api, { cookieSecret: 'test' })
  fastify.register(controller)

  // Test database connection
  fastify.addHook('onReady', async () => {
    await fastify.store.nano.info()
  })

  return { authorization, fastify }
}
