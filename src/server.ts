import Fastify from 'fastify'
import kubernetes from 'fastify-kubernetes'
import noAdditionalProperties from 'fastify-no-additional-properties'

import database from './lib/database.js'
import error from './lib/error.js'
import probes from './lib/probes.js'

import brerApi from './api/brer.js'
import registryApi from './api/registry.js'
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

  const mode = process.env.SERVER_MODE
  if (!mode || mode === 'api') {
    fastify.log.debug('brer api plugin is enabled')
    fastify.register(brerApi)

    if (process.env.REGISTRY_URL) {
      fastify.log.debug('registry api plugin is enabled')
      fastify.register(registryApi)
    } else {
      fastify.log.warn('registry api are disabled')
    }
  }
  if (!mode || mode === 'controller') {
    fastify.log.debug('controller plugin is enabled')
    fastify.register(controller)
  }

  return fastify
}
