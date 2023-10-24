import staticPlugin from '@fastify/static'
import Fastify from 'fastify'
import kubernetes from 'fastify-kubernetes'
import noAdditionalProperties from 'fastify-no-additional-properties'

import database from './lib/database.js'
import error from './lib/error.js'
import events from './lib/events.js'
import probes from './lib/probes.js'
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
    bodyLimit: 1048576, // 1 MiB (bytes)
    caseSensitive: true,
    ignoreTrailingSlash: false,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  })

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

  fastify.register(kubernetes, {
    file: process.env.K8S_FILE,
    context: process.env.K8S_CONTEXT,
    cluster: process.env.K8S_CLUSTER,
    user: process.env.K8S_USER,
    namespace: process.env.K8S_NAMESPACE,
  })

  fastify.register(database, {
    url: process.env.COUCH_URL,
    username: process.env.COUCH_USERNAME,
    password: process.env.COUCH_PASSWORD,
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
  if (modes.includes('registry') && process.env.REGISTRY_URL) {
    fastify.log.debug('registry plugin enabled')
    fastify.register(registry)
  }

  return fastify
}
