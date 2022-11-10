import { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import * as uuid from 'uuid'

function getBearerToken(authorization: unknown) {
  if (typeof authorization === 'string' && /^Bearer \S+$/.test(authorization)) {
    return authorization.substring(7)
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    invocationId: string
  }
}

async function authPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    const invocationId = getBearerToken(request.headers.authorization)
    if (!invocationId) {
      // TODO: 401
      throw new Error()
    }
    if (!uuid.validate(invocationId)) {
      // TODO: 403
      throw new Error()
    }
    request.invocationId = invocationId
  })

  fastify.decorateRequest('invocationId', null)
}

export default plugin(authPlugin, {
  name: 'internal_auth',
})
