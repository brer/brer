import staticPlugin from '@fastify/static'
import Fastify from 'fastify'
import noAdditionalProperties from 'fastify-no-additional-properties'

import error from './lib/error.js'
import events from './lib/events.js'
import pools from './lib/pools.js'
import probes from './lib/probes.js'
import { addSchema } from './lib/schema.js'
import store from './lib/store.js'
import tasks from './lib/tasks.js'

import api from './api/plugin.js'
import invoker from './invoker/plugin.js'
import registry from './registry/plugin.js'

export default function createServer() {
  const fastify = Fastify.default({
    ajv: {
      customOptions: {
        allErrors: process.env.NODE_ENV !== 'production',
        coerceTypes: false,
        removeAdditional: true,
        useDefaults: true,
      },
    },
    bodyLimit: 2097152, // 2 MiB (bytes)
    caseSensitive: true,
    ignoreTrailingSlash: false,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  })

  addSchema(fastify)

  fastify.register(error)
  fastify.register(events)
  fastify.register(tasks)
  fastify.register(noAdditionalProperties.default)

  // TODO: use nginx for this
  if (process.env.STATIC_DIR) {
    fastify.register(staticPlugin, {
      root: process.env.STATIC_DIR,
    })
  }

  fastify.register(store, {
    url: process.env.COUCHDB_URL,
    username: process.env.COUCHDB_USERNAME,
    password: process.env.COUCHDB_PASSWORD,
  })

  fastify.register(probes)

  const defaultUrl = 'http://127.0.0.1:3000/'
  const apiUrl = new URL(process.env.API_URL || defaultUrl)
  const invokerUrl = new URL(process.env.INVOKER_URL || defaultUrl)
  const publicUrl = new URL(process.env.PUBLIC_URL || defaultUrl)
  fastify.register(pools)

  const modes = process.env.SERVER_MODE?.split(',') || ['api']

  if (modes.includes('api')) {
    fastify.log.debug('api plugin enabled')
    fastify.register(api, {
      invokerUrl,
      adminPassword: process.env.ADMIN_PASSWORD,
      cookieName: process.env.COOKIE_NAME,
      gatewayUrl: process.env.GATEWAY_URL
        ? new URL(process.env.GATEWAY_URL)
        : undefined,
      publicUrl,
    })
  }

  if (modes.includes('invoker')) {
    fastify.log.debug('invoker plugin enabled')
    fastify.register(invoker, {
      apiUrl,
      invokerUrl,
      kubernetes: {
        file: process.env.K8S_FILE,
        context: process.env.K8S_CONTEXT,
        cluster: process.env.K8S_CLUSTER,
        user: process.env.K8S_USER,
        namespace: process.env.K8S_NAMESPACE,
      },
    })
  }

  if (modes.includes('registry')) {
    if (!process.env.REGISTRY_URL) {
      throw new Error('The env REGISTRY_URL is required in registry mode')
    }
    fastify.log.debug('registry plugin enabled')
    fastify.register(registry, {
      apiUrl,
      publicUrl,
      registryUrl: new URL(process.env.REGISTRY_URL),
      registryUsername: process.env.REGISTRY_USERNAME,
      registryPassword: process.env.REGISTRY_PASSWORD,
    })
  }

  return fastify
}
