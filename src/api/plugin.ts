import type { FastifyInstance } from 'fastify'

import auth from './auth.js'
import producer from './producer.js'

import functionSchema from './functions/schema.js'
import invocationSchema from './invocations/schema.js'

import functionsRoutes from './functions/plugin.js'
import invocationsRoutes from './invocations/plugin.js'

export default async function apiPlugin(fastify: FastifyInstance) {
  fastify.log.debug('api plugin is enabled')

  fastify.register(auth)
  fastify.register(producer)

  // Register global schema ($ref)
  functionSchema(fastify)
  invocationSchema(fastify)

  // Register the actual routes
  fastify.register(functionsRoutes)
  fastify.register(invocationsRoutes)
}
