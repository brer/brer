import type { FastifyInstance } from '@brer/fastify'
import type { Readable } from 'node:stream'

import { getRegistryClient } from '../lib/registry.js'

export default async function registryPlugin(fastify: FastifyInstance) {
  const got = getRegistryClient()

  fastify.addContentTypeParser('*', function (request, payload, done) {
    done(null)
  })

  // TODO: auth

  fastify.route({
    method: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
    url: '/v2*',
    async handler(request, reply) {
      const remote = await got({
        body: request.body as Readable | undefined,
        method: request.method as any,
        responseType: 'buffer',
        throwHttpErrors: false,
        url: request.url.substring(1),
      })

      const matches = request.url.match(/^\/v2\/(.+)\/manifests\/(.+)/)
      if (request.method === 'PUT' && matches && remote.statusCode === 201) {
        // TODO: update function image (run "test" function)
      }

      // TODO: response headers
      reply.code(remote.statusCode)
      return remote.body
    },
  })
}
