import staticPlugin from '@fastify/static'
import Fastify from 'fastify'
import kubernetes from 'fastify-kubernetes'
import noAdditionalProperties from 'fastify-no-additional-properties'

import auth from './lib/auth.js'
import error from './lib/error.js'
import helmsman from './lib/helmsman.js'
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

  fastify.register(pools)
  fastify.register(error)
  fastify.register(tasks)
  fastify.register(noAdditionalProperties.default)
  fastify.register(auth, {
    adminPassword: process.env.ADMIN_PASSWORD,
    gatewayUrl: process.env.GATEWAY_URL
      ? new URL(process.env.GATEWAY_URL)
      : undefined,
  })

  // TODO: use nginx for this
  if (process.env.STATIC_DIR) {
    fastify.register(staticPlugin, {
      root: process.env.STATIC_DIR,
    })
  }

  fastify.register(kubernetes, {
    file: process.env.K8S_FILE,
    context: process.env.K8S_CONTEXT,
    cluster: process.env.K8S_CLUSTER,
    user: process.env.K8S_USER,
    namespace: process.env.K8S_NAMESPACE,
  })
  fastify.register(helmsman)

  fastify.register(store, {
    url: process.env.COUCHDB_URL,
    username: process.env.COUCHDB_USERNAME,
    password: process.env.COUCHDB_PASSWORD,
  })

  fastify.register(probes)

  const defaultUrl = 'http://127.0.0.1:3000/'
  const apiUrl = new URL(process.env.INVOKER_URL || defaultUrl)
  const invokerUrl = new URL(process.env.INVOKER_URL || defaultUrl)
  const registryUrl = new URL(process.env.REGISTRY_URL || defaultUrl)
  const publicUrl = new URL(process.env.PUBLIC_URL || defaultUrl)

  const modes = process.env.SERVER_MODE?.split(',') || ['api']
  if (modes.includes('api')) {
    fastify.log.debug('api plugin enabled')
    fastify.register(api, { invokerUrl })
  }
  if (modes.includes('invoker')) {
    fastify.log.debug('invoker plugin enabled')
    fastify.register(invoker, { invokerUrl })
  }
  if (modes.includes('registry')) {
    fastify.log.debug('registry plugin enabled')
    fastify.register(registry, { apiUrl, publicUrl, registryUrl })
  }

  return fastify
}
