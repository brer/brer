import type { FastifyContext, FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'
import { parse as parseQS } from 'node:querystring'
import type { Readable } from 'node:stream'

import { basicAuthorization, parseAuthorization } from '../lib/header.js'
import { REGISTRY_ISSUER } from '../lib/token.js'
import postOauth from './oauth.js'
import { getFunctionsList, patchImageTag } from './request.js'
import getToken from './token.js'

export interface PluginOptions {
  apiUrl: URL
  publicUrl: URL
  registryUrl: URL
  registryUsername?: string
  registryPassword?: string
}

interface RouteGeneric {
  Body: Readable | undefined
  Params: {
    imageName: string
    imageTag: string
  }
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

  const registry = fastify.pools.set('registry', registryUrl)
  const registryAuthorization = basicAuthorization(
    registryUsername,
    registryPassword,
  )

  fastify.decorateRequest('token', null)

  fastify.removeAllContentTypeParsers()

  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer' },
    (request, body, done) => done(null, parseQS(body.toString())),
  )

  fastify.addContentTypeParser('*', function (request, payload, done) {
    done(null, payload)
  })

  fastify.addHook<RouteGeneric, FastifyContext>(
    'onRequest',
    async (request, reply) => {
      // https://distribution.github.io/distribution/spec/api/#api-version-check
      reply.header('docker-distribution-api-version', 'registry/2.0')

      if (request.routeOptions.config.public) {
        return
      }

      const authorization = parseAuthorization(request.headers)
      if (authorization?.type !== 'bearer') {
        return reply
          .code(401)
          .header(
            'www-authenticate',
            `Bearer realm="${publicUrl.origin}/v2/token",service="brer.io"`,
          )
          .sendError({ message: 'Unsupported auth scheme.' })
      }

      try {
        request.token = await fastify.token.verifyToken(
          authorization.token,
          REGISTRY_ISSUER,
          REGISTRY_ISSUER,
        )
      } catch (err) {
        request.log.debug({ err }, 'invalid registry token')
        return reply.code(401).sendError()
      }

      if (
        request.params.imageName &&
        request.params.imageName !== request.token.repository
      ) {
        return reply.code(403).sendError()
      }
    },
  )

  fastify.route(postOauth())
  fastify.route(getToken())

  fastify.route<RouteGeneric>({
    method: 'GET',
    url: '/v2/',
    async handler(request, reply) {
      const response = await registry.request({
        method: 'GET',
        path: request.url,
        headers: prepareHeaders({
          ...request.headers,
          authorization: registryAuthorization,
        }),
      })

      reply.code(response.statusCode)
      reply.headers(prepareHeaders(response.headers))
      return response.body
    },
  })

  fastify.route<RouteGeneric>({
    method: 'PUT',
    url: '/v2/:imageName/manifests/:imageTag',
    async handler(request, reply) {
      const response = await registry.request({
        method: 'PUT',
        path: request.url,
        headers: prepareHeaders({
          ...request.headers,
          authorization: registryAuthorization,
        }),
        body: request.body,
      })

      if (response.statusCode === 201) {
        const result = await getFunctionsList(
          this,
          'Bearer ' + request.token.raw,
        )
        if (result.isErr) {
          request.log.error(result.unwrapErr(), 'cannot update function image')
        } else {
          fastify.tasks.push(() =>
            Promise.all(
              result.unwrap().map(functionName =>
                patchImageTag(
                  this,
                  'Bearer ' + request.token.raw,
                  functionName,
                  {
                    realHost: registryUrl.host,
                    host: publicUrl.host,
                    name: request.params.imageName,
                    tag: request.params.imageTag,
                  },
                ),
              ),
            ),
          )
        }
      }

      reply.code(response.statusCode)
      reply.headers(prepareHeaders(response.headers))
      return response.body
    },
  })

  fastify.route<RouteGeneric>({
    method: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
    url: '/v2/:imageName/*',
    async handler(request, reply) {
      const resRegistry = await registry.request({
        method: request.method as any,
        path: request.url,
        headers: prepareHeaders({
          ...request.headers,
          authorization: registryAuthorization,
        }),
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
    fastify: ['pools', 'token'],
  },
  encapsulate: true,
})
