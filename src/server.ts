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
  fastify.register(noAdditionalProperties, {
    body: true,
    headers: false,
    params: true,
    query: true,
    response: true,
  })

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
  fastify.register(pools)

  const k8s = !!process.env.KUBERNETES_SERVICE_HOST
  const namespace = process.env.K8S_NAMESPACE || 'default'

  const modes = process.env.SERVER_MODE?.split(',') || ['api']

  const brerPort = parseInt(process.env.SERVER_PORT || '3000')
  const brerUrl = `http://127.0.0.1:${brerPort}/`

  const apiUrl = url(
    process.env.API_URL,
    k8s && !modes.includes('api')
      ? `http://brer-api.${namespace}.svc.cluster.local/`
      : undefined,
    brerUrl,
  )

  const invokerUrl = url(
    process.env.INVOKER_URL,
    k8s && !modes.includes('invoker')
      ? `http://brer-invoker.${namespace}.svc.cluster.local/`
      : undefined,
    brerUrl,
  )

  const publicUrl = url(process.env.PUBLIC_URL, brerUrl)

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

function url(...values: Array<string | undefined>): URL {
  for (const value of values) {
    if (value) {
      return new URL(value)
    }
  }
  throw new Error('Cannot find a valid value')
}
