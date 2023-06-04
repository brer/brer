import Fastify from 'fastify'
import kubernetes from 'fastify-kubernetes'
import noAdditionalProperties from 'fastify-no-additional-properties'

import database from './lib/database.js'
import error from './lib/error.js'
import probes from './lib/probes.js'

import api from './api/plugin.js'
import controller from './controller/plugin.js'

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
      level: process.env.LOG_LEVEL,
    },
  })

  fastify.register(error)

  fastify.register(noAdditionalProperties)

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

  const mode = process.env.SERVER_MODE || null
  if (!mode || mode === 'api') {
    fastify.register(api)
  }
  if (!mode || mode === 'controller') {
    fastify.register(controller)
  }

  return fastify
}
