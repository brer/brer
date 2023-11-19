import staticPlugin from '@fastify/static'
import Fastify from 'fastify'
import kubernetes from 'fastify-kubernetes'
import noAdditionalProperties from 'fastify-no-additional-properties'

import auth from './lib/auth.js'
import error from './lib/error.js'
import helmsman from './lib/helmsman.js'
import probes from './lib/probes.js'
import store from './lib/store.js'
import tasks from './lib/tasks.js'

import api from './api/plugin.js'
import controller from './controller/plugin.js'
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

  const modes = process.env.SERVER_MODE?.split(',') || ['api']
  if (modes.includes('api')) {
    fastify.log.debug('api plugin enabled')
    fastify.register(api, {
      cookieSecret: process.env.COOKIE_SECRET,
      notifyController:
        !!process.env.KUBERNETES_SERVICE_HOST && !modes.includes('controller'),
    })
  }
  if (modes.includes('controller')) {
    fastify.log.debug('controller plugin enabled')
    fastify.register(controller)
  }
  if (modes.includes('registry')) {
    fastify.log.debug('registry plugin enabled')
    if (!process.env.PUBLIC_URL) {
      throw new Error('Env PUBLIC_URL is missing')
    }
    if (!process.env.REGISTRY_URL) {
      throw new Error('Env REGISTRY_URL is missing')
    }
    fastify.register(registry, {
      publicUrl: new URL(process.env.PUBLIC_URL),
      registryUrl: new URL(process.env.REGISTRY_URL),
    })
  }

  return fastify
}
