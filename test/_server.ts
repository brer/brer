import type { FastifyInstance } from '@brer/fastify'
import Fastify from 'fastify'
import noAdditionalProperties from 'fastify-no-additional-properties'
import { v4 as uuid } from 'uuid'

import error from '../src/lib/error.js'
import events from '../src/lib/events.js'
import { basicAuthorization } from '../src/lib/header.js'
import { addSchema } from '../src/lib/schema.js'
import store from '../src/lib/store.js'
import token from '../src/lib/token.js'
import { noop } from '../src/lib/util.js'

import api from '../src/api/plugin.js'
import invokerController from '../src/invoker/controller.js'
import invokerRouter from '../src/invoker/router.js'
import invokerSpawn from '../src/invoker/spawn.js'

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
      level: 'debug',
      transport: {
        target: 'pino/file',
        options: {
          append: false,
          destination: './fastify.ndjson',
          mkdir: true,
        },
      },
    },
  })

  addSchema(fastify)

  // Just a random password
  const adminPassword = uuid()

  // Authorization header
  const authorization = basicAuthorization('admin', adminPassword)

  fastify.register(token, { secret: uuid() })
  fastify.register(error)
  fastify.register(events)
  fastify.register(noAdditionalProperties, {
    body: true,
    headers: false,
    params: true,
    query: true,
    response: true,
  })

  fastify.decorate('kubernetes', {
    getter() {
      throw new Error('Kubernetes plugin not available')
    },
  })

  // Super Power Ninja Turbo Neo Ultra Hyper Mega Multi Alpha Meta Extra Uber Prefix __HACK__
  const pool: any = {
    async request(options: any) {
      const response = await fastify.inject({
        method: options.method,
        path: options.path,
        headers: options.headers,
        body: options.body,
      })

      return {
        statusCode: response.statusCode,
        headers: response.headers,
        body: {
          text: async () => response.payload,
          json: async () => response.json(),
        },
      }
    },
  }
  fastify.decorate('pools', {
    get: () => pool,
    set: () => pool,
  })

  const asyncNoop = () => Promise.resolve()
  const helmsman: FastifyInstance['helmsman'] = {
    namespace: 'default',
    createPod: pod => Promise.resolve(pod),
    deleteInvocationPods: asyncNoop,
    deletePod: asyncNoop,
    getPodByInvocationId: () => Promise.resolve(null),
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

  const url = new URL('http://127.0.0.1:3000')
  fastify.register(api, {
    adminPassword,
    invokerUrl: url,
  })
  fastify.register(invokerController)
  fastify.register(invokerRouter)
  fastify.register(invokerSpawn, {
    invokerUrl: url,
  })

  // Test database connection
  fastify.addHook('onReady', async () => {
    await fastify.store.nano.info()
  })

  return { adminPassword, authorization, fastify }
}
