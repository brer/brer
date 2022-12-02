import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'

import { decodeToken } from './token.js'

declare module 'fastify' {
  interface FastifyRequest {
    invocationId: string | null
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
        const reg = new RegExp(`^/api/v\\d+/invocations/${invocationId}`)
        if (reg.test(request.url)) {
          request.invocationId = invocationId
        }
      } else {
        log.trace({ token }, 'invalid token signature')
      }
    } catch (err) {
      log.trace({ token, err }, 'malformed internal token')
    }

    // TODO: authenticate other way
    if (
      !request.invocationId &&
      token !== 'isweariwillimplementarealauthenticationservice'
    ) {
      return reply.code(403).send(invalidToken)
    }
  })
}

export default plugin(authPlugin, {
  name: 'auth',
})
