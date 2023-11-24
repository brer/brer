import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'

import { parseAuthorization } from '../lib/header.js'
import { authenticate } from './request.js'

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Registry authorization header for requesting API.
     */
    authorization: string
  }
}

async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('authorization', null)

  /**
   * Verify JWT token.
   */
  fastify.addHook('onRequest', async (request, reply) => {
    // https://distribution.github.io/distribution/spec/api/#api-version-check
    reply.header('docker-distribution-api-version', 'registry/2.0')

    const authorization = parseAuthorization(request.headers)
    if (authorization?.type !== 'basic') {
      return reply
        .code(401)
        .header('www-authenticate', 'Basic')
        .sendError({ message: 'Unsupported auth scheme.' })
    }

    const result = await authenticate(fastify, authorization.raw)
    if (result.isOk) {
      request.authorization = authorization.raw
    } else {
      return reply.code(401).sendError(result.unwrapErr())
    }
  })
}

export default plugin(authPlugin, {
  name: 'auth',
  decorators: {
    fastify: ['pools'],
  },
})
