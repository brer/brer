import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import plugin from 'fastify-plugin'

import { parseAuthorization } from '../lib/header.js'
import { INVOKER_ISSUER, type Token } from '../lib/tokens.js'

declare module 'fastify' {
  interface FastifyRequest {
    token: Token
  }
}

async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('token', null)

  /**
   * Verify JWT token.
   */
  fastify.addHook('onRequest', async (request: FastifyRequest, reply) => {
    const { headers, log } = request

    const authorization = parseAuthorization(headers)
    if (authorization?.type !== 'bearer') {
      return reply
        .code(401)
        .sendError({ message: 'Unsupported authorization scheme.' })
    }

    try {
      request.token = await fastify.tokens.verifyToken(
        authorization.token,
        INVOKER_ISSUER,
        request.routeOptions.config.tokenIssuer || INVOKER_ISSUER,
      )
    } catch (err) {
      log.debug({ err }, 'jwt verification failed')
      return reply.code(401).sendError({ message: 'Unrecognized token.' })
    }
  })

  interface MaybeInvocation {
    Params: {
      invocationId?: string
    }
  }

  /**
   * Enforce token scope for Invoker's tokens.
   */
  fastify.addHook(
    'preHandler',
    async (request: FastifyRequest<MaybeInvocation>, reply) => {
      if (
        request.params.invocationId &&
        request.token.issuer === INVOKER_ISSUER &&
        request.token.subject !== request.params.invocationId
      ) {
        return reply.sendError({
          message: 'Resource not found.',
          statusCode: 404,
        })
      }
    },
  )
}

export default plugin(authPlugin, {
  name: 'auth',
})
