import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'

import { decodeToken } from '../lib/token.js'

declare module 'fastify' {
  interface FastifyRequest {
    invocationId: string
  }
}

async function authPlugin(fastify: FastifyInstance) {
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

  fastify.addHook('onRequest', async (request, reply) => {
    const { headers, log } = request

    const token =
      typeof headers.authorization === 'string' &&
      /^Bearer \S/.test(headers.authorization)
        ? headers.authorization.substring(7)
        : null

    if (!token) {
      return reply.code(401).send(noAuth)
    }

    try {
      const invocationId = decodeToken(token)
      if (invocationId) {
        request.invocationId = invocationId
      }
    } catch (err) {
      log.debug({ token, err }, 'malformed internal token')
    }

    if (!request.invocationId) {
      return reply.code(403).send(invalidToken)
    }
  })
}

export default plugin(authPlugin, {
  name: 'auth',
})
