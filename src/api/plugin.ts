import type { FastifyInstance } from '@brer/fastify'
import cookies from '@fastify/cookie'

import authRoutes from './auth.js'
import functionsRoutes from './functions/plugin.js'
import functionsSchema from './functions/schema.js'
import invocationsRoutes from './invocations/plugin.js'
import invocationsSchema from './invocations/schema.js'
import projectsRoutes from './projects/plugin.js'
import projectsSchema from './projects/schema.js'

export interface PluginOptions {
  cookieSecret?: string
  notifyController?: boolean
}

export default async function apiPlugin(
  fastify: FastifyInstance,
  options: PluginOptions,
) {
  if (!options.cookieSecret) {
    throw new Error('Required env var COOKIE_SECRET is missing')
  }

  fastify.register(cookies, {
    hook: 'onRequest',
    secret: options.cookieSecret,
  })

  // Register global schema ($ref)
  functionsSchema(fastify)
  invocationsSchema(fastify)
  projectsSchema(fastify)

  await authRoutes(fastify)
  await functionsRoutes(fastify)
  await invocationsRoutes(fastify)
  await projectsRoutes(fastify)
}
