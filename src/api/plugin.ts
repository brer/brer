import type { FastifyInstance } from 'fastify'

import auth from '../lib/auth.js'

import functionSchema from './functions/schema.js'
import invocationSchema from './invocations/schema.js'

import functionsRoutes from './functions/plugin.js'
import invocationsRoutes from './invocations/plugin.js'

export default async function apiPlugin(fastify: FastifyInstance) {
  // Global auth plugin (register here to monito only api routes)
  fastify.register(auth)

  // Register global schema ($ref)
  functionSchema(fastify)
  invocationSchema(fastify)

  // Register the actual routes
  fastify.register(functionsRoutes)
  fastify.register(invocationsRoutes)
}
