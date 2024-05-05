import Fastify from 'fastify'
import noAdditionalProperties from 'fastify-no-additional-properties'

import error from './lib/error.js'
import pools from './lib/pools.js'
import probes from './lib/probes.js'
import { addSchema } from './lib/schema.js'
import store from './lib/store.js'
import tasks from './lib/tasks.js'
import tokens from './lib/tokens.js'

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
    requestTimeout: 60000,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport:
        process.env.LOG_PRETTY === 'enable'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: true,
              },
            }
          : {
              target: 'pino/file',
              options: {
                destination: process.env.LOG_FILE || process.stdout.fd,
              },
            },
    },
  })

  addSchema(fastify)

  fastify.register(tokens, {
    secret: process.env.JWT_SECRET,
    privateKey: process.env.JWT_PRIVATE_KEY,
    publicKeys: pickDefined(
      process.env.API_PUBLIC_KEY,
      process.env.INVOKER_PUBLIC_KEY,
      process.env.REGISTRY_PUBLIC_KEY,
    ),
  })

  fastify.register(error)
  fastify.register(tasks)
  fastify.register(pools)
  fastify.register(noAdditionalProperties, {
    body: true,
    headers: false,
    params: true,
    query: true,
    response: true,
  })

  const modes = process.env.SERVER_MODE?.split(',') || ['api']
  if (modes.includes('api') || modes.includes('invoker')) {
    fastify.register(store, {
      url: process.env.COUCHDB_URL,
      username: process.env.COUCHDB_USERNAME,
      password: process.env.COUCHDB_PASSWORD,
    })
  }

  fastify.register(probes)

  const k8s = !!process.env.KUBERNETES_SERVICE_HOST
  const namespace = process.env.K8S_NAMESPACE || 'default'

  const serverPort = parseInt(process.env.SERVER_PORT || '3000')
  const publicUrl = process.env.PUBLIC_URL || `http://127.0.0.1:${serverPort}/`

  const apiUrl = url(
    process.env.API_URL,
    k8s && !modes.includes('api')
      ? `http://brer-api.${namespace}.svc.cluster.local/`
      : undefined,
    publicUrl,
  )

  const invokerUrl = url(
    process.env.INVOKER_URL,
    k8s && !modes.includes('invoker')
      ? `http://brer-invoker.${namespace}.svc.cluster.local/`
      : undefined,
    publicUrl,
  )

  if (modes.includes('api')) {
    fastify.log.debug('api plugin enabled')
    fastify.register(api, {
      invokerUrl,
      adminPassword: process.env.ADMIN_PASSWORD,
      cookieName: process.env.COOKIE_NAME,
      gatewayUrl: process.env.GATEWAY_URL
        ? new URL(process.env.GATEWAY_URL)
        : undefined,
      registryUrl: process.env.REGISTRY_URL
        ? new URL(process.env.REGISTRY_URL)
        : undefined,
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
      publicUrl: new URL(publicUrl),
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

function pickDefined(...values: Array<string | undefined>): string[] {
  const results: string[] = []
  for (const value of values) {
    if (value) {
      results.push(value)
    }
  }
  return results
}
