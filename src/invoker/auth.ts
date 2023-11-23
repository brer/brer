import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import plugin from 'fastify-plugin'

import { parseAuthorization } from '../lib/header.js'
import { INVOKER_ISSUER, type Token, verifyToken } from '../lib/token.js'

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

    const raw = authorization?.type === 'bearer' ? authorization.token : null
    if (raw) {
      try {
        request.token = await verifyToken(
          raw,
          INVOKER_ISSUER,
          request.routeOptions.config.tokenIssuer || INVOKER_ISSUER,
        )
      } catch (err) {
        log.debug({ err }, 'jwt verification failed')
      }
    }

    if (!request.token) {
      return reply.code(401).sendError()
    }
  })

  interface MaybeInvocation {
    Params: {
      invocationId?: string
    }
  }

  /**
   * Enfore token scope for Invoker's tokens.
   */
  fastify.addHook(
    'preHandler',
    async (request: FastifyRequest<MaybeInvocation>, reply) => {
      if (
        request.params.invocationId &&
        request.token.issuer === INVOKER_ISSUER &&
        request.token.subject !== request.params.invocationId
      ) {
        return reply.sendError({ status: 404 })
      }
    },
  )
}

export default plugin(authPlugin, {
  name: 'auth',
})
