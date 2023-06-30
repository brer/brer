import type { FastifyInstance } from '@brer/types'
import cookies from '@fastify/cookie'

import functionsRoutes from './functions/plugin.js'
import functionSchema from './functions/schema.js'
import invocationsRoutes from './invocations/plugin.js'
import invocationSchema from './invocations/schema.js'
import authRoutes from './auth.js'

export default async function apiPlugin(fastify: FastifyInstance) {
  if (!process.env.COOKIE_SECRET) {
    throw new Error('Required env var COOKIE_SECRET is missing')
  }

  fastify.register(cookies, {
    hook: 'onRequest',
    secret: process.env.COOKIE_SECRET,
  })

  // Register global schema ($ref)
  functionSchema(fastify)
  invocationSchema(fastify)

  await authRoutes(fastify)
  await functionsRoutes(fastify)
  await invocationsRoutes(fastify)
}
