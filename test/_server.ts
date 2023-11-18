import Fastify from 'fastify'
import noAdditionalProperties from 'fastify-no-additional-properties'

import auth from '../src/lib/auth.js'
import error from '../src/lib/error.js'
import store from '../src/lib/store.js'

import api from '../src/api/plugin.js'

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
      level: 'silent',
    },
  })

  fastify.register(error)
  fastify.register(noAdditionalProperties.default)
  fastify.register(auth, {
    adminPassword: process.env.ADMIN_PASSWORD,
  })

  fastify.decorate('kubernetes', {
    getter() {
      throw new Error('Kubernetes plugin not available')
    },
  })

  fastify.decorate('events', {
    getter() {
      throw new Error('Events plugin not available')
    },
  })

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

  // Test database connection
  fastify.addHook('onReady', async () => {
    await fastify.store.nano.info()
  })

  return fastify
}
