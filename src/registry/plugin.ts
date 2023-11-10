import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import type { Readable } from 'node:stream'
import { Pool } from 'undici'

import { parseAuthorizationHeader } from '../lib/auth.js'
import { createAsyncCache } from '../lib/cache.js'
import { type RequestResult } from '../lib/error.js'
import * as Result from '../lib/result.js'
import { updateFunction } from '../lib/function.js'
import { createInvocation } from '../lib/invocation.js'

export interface PluginOptions {
  publicUrl: URL
  registryUrl: URL
}

export default async function registryPlugin(
  fastify: FastifyInstance,
  { publicUrl, registryUrl }: PluginOptions,
) {
  const authorization = getAuthorizationHeader()

  // A push will make A LOT of requests.
  // Cache the auth step for 1min to improve performance.
  const cache = createAsyncCache<RequestResult<string[]>>(60)
  const timer = setInterval(cache.release, cache.ttlSeconds * 1000)

  const pool = new Pool(registryUrl.origin, {
    connections: 32,
    pipelining: 1,
  })

  fastify.addHook('onClose', async () => {
    clearInterval(timer)
    await pool.close()
  })

  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser('*', function (request, payload, done) {
    done(null, payload)
  })

  fastify.decorateRequest('session', null)

  fastify.addHook('onRequest', async (request: FastifyRequest, reply) => {
    // https://distribution.github.io/distribution/spec/api/#api-version-check
    reply.header('docker-distribution-api-version', 'registry/2.0')

    const auth = parseAuthorizationHeader(request.headers.authorization)
    if (auth?.type !== 'basic') {
      return reply
        .code(401)
        .header('www-authenticate', 'Basic')
        .sendError({ message: 'Unsupported auth scheme.' })
    }

    // Cache set after authentication AND authorization
    if (!cache.has(auth.username)) {
      const result = await fastify.gateway.authenticate(
        auth.username,
        auth.password,
      )
      if (result.isErr) {
        return reply.code(401).sendError(result.unwrapErr())
      }
    }

    request.session = {
      type: 'basic',
      username: auth.username,
    }
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
      const response = await pool.request({
        method: 'GET',
        path: request.url,
        headers: prepareHeaders({ ...request.headers, authorization }),
      })

      reply.code(response.statusCode)
      reply.headers(prepareHeaders(response.headers))
      return response.body
    },
  })

  const authorizeRegistryAction = async (
    request: FastifyRequest<RouteGeneric>,
  ): Promise<RequestResult<string[]>> => {
    const response = await fastify.store.functions.adapter.nano.view<string[]>(
      'default',
      'registry',
      {
        group: true,
        key: [publicUrl.host, request.params.imageName],
        reduce: true,
        sorted: false,
      },
    )

    let groups: string[] = response.rows[0]?.value || []

    if (groups.length) {
      const role =
        request.method === 'GET' || request.method === 'HEAD'
          ? 'registry_read'
          : 'registry_write'

      const result = await fastify.gateway.authorize(
        request.session.username,
        role,
        groups,
      )
      if (result.isErr) {
        return result.expectErr()
      } else {
        groups = result.unwrap() || []
      }
    }

    return Result.ok(groups)
  }

  /**
   * A "docker push" will make A LOT of almost-concurrent requests.
   * This "1 minute cache" will make the whole process super-smooth (no auth delay).
   */
  const cachedAuthorization = async (
    request: FastifyRequest<RouteGeneric>,
  ): Promise<RequestResult<string[]>> => {
    const cacheHit = await cache.get(request.session.username)
    if (cacheHit) {
      return cacheHit
    } else {
      return cache.set(
        request.session.username,
        authorizeRegistryAction(request),
      )
    }
  }

  fastify.route({
    method: 'PUT',
    url: '/v2/:imageName/manifests/:imageTag',
    async handler(request: FastifyRequest<RouteGeneric>, reply) {
      const result = await cachedAuthorization(request)
      if (result.isErr) {
        return reply.code(403).error(result.unwrapErr())
      }

      const groups = result.unwrap()
      if (!groups.length) {
        return reply.code(404).error()
      }

      const response = await pool.request({
        method: 'PUT',
        path: request.url,
        headers: prepareHeaders({ ...request.headers, authorization }),
        body: request.body,
      })

      if (response.statusCode === 201) {
        const iterable = fastify.store.functions
          .filter({
            _design: 'default',
            _view: 'registry',
            key: [publicUrl.host, request.params.imageName], // filter by image
          })
          .filter(fn => groups.includes(fn.group))
          .tap(fn =>
            request.log.trace(
              { tag: request.params.imageTag },
              `update ${fn.name} image tag`,
            ),
          )
          .update(fn =>
            updateFunction(fn, {
              ...fn,
              image: {
                ...fn.image,
                tag: request.params.imageTag,
              },
            }),
          )
          .iterate({
            sorted: false,
          })

        let fnIds: string[] = []
        try {
          fnIds = await mapAndCollect(iterable, fn => fn._id)
        } catch (err) {
          request.log.error({ err }, 'failed to update functions image tag')
        }

        if (fnIds.length) {
          this.tasks.push(async () => {
            for (const id of fnIds) {
              const fn = await this.store.functions.read(id).unwrap()
              const invocation = await this.store.invocations
                .create(
                  createInvocation({
                    fn,
                    env: {
                      BRER_MODE: 'test',
                    },
                  }),
                )
                .unwrap()

              this.events.emit('brer.invocations.invoke', { invocation })
            }
          })
        }
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
      const result = await cachedAuthorization(request)
      if (result.isErr) {
        return reply.code(403).error(result.unwrapErr())
      }

      const groups = result.unwrap()
      if (!groups.length) {
        return reply.code(404).error()
      }

      const resRegistry = await pool.request({
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

function getAuthorizationHeader() {
  let data = ''
  if (process.env.REGISTRY_USERNAME) {
    data += process.env.REGISTRY_USERNAME
  }
  data += ':'
  if (process.env.REGISTRY_PASSWORD) {
    data += process.env.REGISTRY_PASSWORD
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

async function mapAndCollect<A, B>(
  iterable: AsyncIterable<A>,
  fn: (value: A) => B,
): Promise<B[]> {
  const results: B[] = []
  for await (const item of iterable) {
    results.push(fn(item))
  }
  return results
}
