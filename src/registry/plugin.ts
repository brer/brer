import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import type { Readable } from 'node:stream'
import { Pool } from 'undici'

import { type RequestResult } from '../lib/error.js'
import { updateFunction } from '../lib/function.js'
import { parseAuthorizationHeader } from '../lib/header.js'
import { createInvocation } from '../lib/invocation.js'
import * as Result from '../lib/result.js'
export interface PluginOptions {
  publicUrl: URL
  registryUrl: URL
}

export default async function registryPlugin(
  fastify: FastifyInstance,
  { publicUrl, registryUrl }: PluginOptions,
) {
  const authorization = getAuthorizationHeader()

  const pool = new Pool(registryUrl.origin, {
    connections: 32,
    pipelining: 1,
  })

  fastify.addHook('onClose', async () => {
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
    const result = await fastify.auth.authenticate(auth.username, auth.password)
    if (result.isErr) {
      return reply.sendError(result.unwrapErr())
    }

    request.session = {
      ...result.unwrap(),
      type: 'basic',
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
    const response = await fastify.store.functions.adapter.nano.view<any>(
      'default',
      'registry',
      {
        group: true,
        key: [publicUrl.host, request.params.imageName],
        reduce: true,
        sorted: false,
      },
    )

    // All projects with this image
    const values: string[] = response.rows[0]?.value || []

    const results = await Promise.all(
      values.map(p => fastify.auth.authorize(request.session, 'publisher', p)),
    )

    const projects = results.filter(r => r.isOk).map(r => r.unwrap())

    if (!projects.length) {
      // No projects, no api :)
      return Result.err({ status: 404 })
    }

    return Result.ok(projects)
  }

  fastify.route({
    method: 'PUT',
    url: '/v2/:imageName/manifests/:imageTag',
    async handler(request: FastifyRequest<RouteGeneric>, reply) {
      const result = await authorizeRegistryAction(request)
      if (result.isErr) {
        return reply.code(403).error(result.unwrapErr())
      }

      const projects = result.unwrap()

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
            key: [publicUrl.host, request.params.imageName],
          })
          .filter(fn => projects.includes(fn.project))
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
      const result = await authorizeRegistryAction(request)
      if (result.isErr) {
        return reply.code(403).error(result.unwrapErr())
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
