import type { FastifyInstance } from 'fastify'

import functionSchema from './functions/schema.js'
import invocationSchema from './invocations/schema.js'

import functionsRoutes from './functions/plugin.js'
import invocationsRoutes from './invocations/plugin.js'

export default async function brerPlugin(fastify: FastifyInstance) {
  fastify.log.debug('api plugin is enabled')

  fastify.decorateRequest('invocationId', null)

  const noAuth = {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Auth info not provided.',
    },
  }

  const invalidToken = {
    error: {
      code: 'TOKEN_INVALID',
      message: 'Auth token not valid.',
    },
  }

  const secretToken = process.env.SECRET_TOKEN
  if (!secretToken) {
    throw new Error('Secret auth token is missing')
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const { headers } = request

    const token =
      typeof headers.authorization === 'string' &&
      /^Bearer \S/.test(headers.authorization)
        ? headers.authorization.substring(7)
        : null

    if (!token) {
      return reply.code(401).send(noAuth)
    }

    if (token !== secretToken) {
      return reply.code(403).send(invalidToken)
    }
  })

  // Register global schema ($ref)
  functionSchema(fastify)
  invocationSchema(fastify)

  // Register the actual routes
  fastify.register(functionsRoutes)
  fastify.register(invocationsRoutes)
}
