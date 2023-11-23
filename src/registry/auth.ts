import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'

import { parseAuthorization } from '../lib/header.js'
import { signRegistryToken } from '../lib/token.js'
import { authenticate } from './request.js'

async function authPlugin(fastify: FastifyInstance) {
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

    const token = await signRegistryToken(authorization.username)

    const result = await authenticate(
      fastify,
      authorization.username,
      authorization.password,
    )
    if (result.isOk) {
      request.session = { type: 'basic', token }
    } else {
      return reply.code(401).sendError(result.unwrapErr())
    }
  })

  fastify.decorateRequest('session', null)
}

export default plugin(authPlugin, {
  name: 'auth',
  decorators: {
    fastify: ['pools'],
  },
})
