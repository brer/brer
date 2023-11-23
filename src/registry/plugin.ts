import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import plugin from 'fastify-plugin'
import type { Readable } from 'node:stream'

import { type RequestResult } from '../lib/error.js'
import * as Result from '../lib/result.js'
import auth from './auth.js'
import { patchImageTag } from './request.js'

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

  const authorization = getAuthorizationHeader(
    registryUsername,
    registryPassword,
  )
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

  interface PartialFn {
    name: string
    project: string
  }

  /**
   * Resolves with the list of functions to update.
   */
  const authorizeRegistryAction = async (
    request: FastifyRequest<RouteGeneric>,
  ): Promise<RequestResult<PartialFn[]>> => {
    const response = await fastify.store.functions.adapter.scope.view<
      PartialFn[]
    >('default', 'registry', {
      group: true,
      key: [publicUrl.host, request.params.imageName],
      reduce: true,
      sorted: false,
    })

    const items = response.rows[0]?.value || []
    if (items.length) {
      return Result.ok(items)
    } else {
      return Result.err({ status: 404 })
    }
  }

  fastify.route({
    method: 'PUT',
    url: '/v2/:imageName/manifests/:imageTag',
    async handler(request: FastifyRequest<RouteGeneric>, reply) {
      const result = await authorizeRegistryAction(request)
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
            result
              .unwrap()
              .map(obj =>
                patchImageTag(
                  this,
                  request.session.token,
                  obj.name,
                  request.params.imageTag,
                ),
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
      const result = await authorizeRegistryAction(request)
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

function getAuthorizationHeader(username?: string, password?: string) {
  let data = ''
  if (username) {
    data += username
  }
  data += ':'
  if (password) {
    data += password
  }
  return 'Basic ' + Buffer.from(data).toString('base64')
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
    fastify: ['store'],
  },
  encapsulate: true,
})
