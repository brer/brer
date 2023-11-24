import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import plugin from 'fastify-plugin'
import type { Readable } from 'node:stream'

import { basicAuthorization } from '../lib/header.js'
import auth from './auth.js'
import { getFunctionsList, patchImageTag } from './request.js'

export interface PluginOptions {
  apiUrl: URL
  publicUrl: URL
  registryUrl: URL
  registryUsername?: string
  registryPassword?: string
}

async function registryPlugin(
  fastify: FastifyInstance,
  {
    apiUrl,
    publicUrl,
    registryUrl,
    registryUsername,
    registryPassword,
  }: PluginOptions,
) {
  fastify.pools.set('api', apiUrl)
  fastify.register(auth)

  const authorization = basicAuthorization(registryUsername, registryPassword)
  const registry = fastify.pools.set('registry', registryUrl)

  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser('*', function (request, payload, done) {
    done(null, payload)
  })

  interface RouteGeneric {
    Body: Readable | undefined
    Params: {
      imageName: string
      imageTag: string
    }
  }

  fastify.route({
    method: 'GET',
    url: '/v2/',
    async handler(request: FastifyRequest<RouteGeneric>, reply) {
      const response = await registry.request({
        method: 'GET',
        path: request.url,
        headers: prepareHeaders({ ...request.headers, authorization }),
      })

      reply.code(response.statusCode)
      reply.headers(prepareHeaders(response.headers))
      return response.body
    },
  })

  fastify.route({
    method: 'PUT',
    url: '/v2/:imageName/manifests/:imageTag',
    async handler(request: FastifyRequest<RouteGeneric>, reply) {
      const result = await getFunctionsList(
        this,
        request.authorization,
        publicUrl.host,
        request.params.imageName,
      )
      if (result.isErr) {
        return reply.code(403).error(result.unwrapErr())
      }

      const response = await registry.request({
        method: 'PUT',
        path: request.url,
        headers: prepareHeaders({ ...request.headers, authorization }),
        body: request.body,
      })

      if (response.statusCode === 201) {
        fastify.tasks.push(() =>
          Promise.all(
            result.unwrap().map(functionName =>
              patchImageTag(this, request.authorization, functionName, {
                host: publicUrl.host,
                name: request.params.imageName,
                tag: request.params.imageTag,
              }),
            ),
          ),
        )
      }

      reply.code(response.statusCode)
      reply.headers(prepareHeaders(response.headers))
      return response.body
    },
  })

  fastify.route({
    method: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
    url: '/v2/:imageName/*',
    async handler(request: FastifyRequest<RouteGeneric>, reply) {
      const result = await getFunctionsList(
        this,
        request.authorization,
        publicUrl.host,
        request.params.imageName,
      )
      if (result.isErr) {
        return reply.code(403).error(result.unwrapErr())
      }

      const resRegistry = await registry.request({
        method: request.method as any,
        path: request.url,
        headers: prepareHeaders({ ...request.headers, authorization }),
        body: request.body,
      })

      reply.code(resRegistry.statusCode)
      reply.headers(prepareHeaders(resRegistry.headers))
      return resRegistry.body
    },
  })
}

type Headers = Record<string, undefined | string | string[]>

function prepareHeaders(headers: Headers): Headers {
  const result: Headers = { ...headers }

  // TODO: other hop-by-hop headers (connection)
  delete result['connection']
  delete result['host']
  delete result['keep-alive']
  delete result['proxy-authenticate']
  delete result['proxy-authorization']
  delete result['te']
  delete result['trailer']
  delete result['transfer-encoding']
  delete result['upgrade']

  return result
}

export default plugin(registryPlugin, {
  name: 'registry',
  decorators: {
    fastify: ['pools'],
  },
  encapsulate: true,
})
