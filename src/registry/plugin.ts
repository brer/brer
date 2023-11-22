import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import plugin from 'fastify-plugin'
import type { Readable } from 'node:stream'

import { type RequestResult } from '../lib/error.js'
import { parseAuthorization } from '../lib/header.js'
import * as Result from '../lib/result.js'
import { signRegistryToken } from '../lib/token.js'

export interface PluginOptions {
  apiUrl: URL
  publicUrl: URL
  registryUrl: URL
}

async function registryPlugin(
  fastify: FastifyInstance,
  { apiUrl, publicUrl, registryUrl }: PluginOptions,
) {
  const api = fastify.createPool(apiUrl)

  const patchImageTag = async (
    username: string,
    fnName: string,
    imageTag: string,
  ) => {
    const token = await signRegistryToken(username)

    const response = await api.request({
      method: 'PATCH',
      path: `/api/v1/functions/${fnName}`,
      headers: {
        accept: '*/*',
        authorization: `Bearer ${token.raw}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        image: {
          tag: imageTag,
        },
      }),
    })

    const text = await response.body.text()
    if (response.statusCode === 200) {
      fastify.log.debug('image tag updated')
    } else if (response.statusCode === 404) {
      fastify.log.warn('function not found')
    } else {
      fastify.log.error(
        { body: text, status: response.statusCode },
        'cannot update function image tag',
      )
    }
  }

  const authorization = getAuthorizationHeader()
  const registry = fastify.createPool(registryUrl)

  fastify.removeAllContentTypeParsers()
  fastify.addContentTypeParser('*', function (request, payload, done) {
    done(null, payload)
  })

  fastify.decorateRequest('session', null)

  fastify.addHook('onRequest', async (request: FastifyRequest, reply) => {
    // https://distribution.github.io/distribution/spec/api/#api-version-check
    reply.header('docker-distribution-api-version', 'registry/2.0')

    const authorization = parseAuthorization(request.headers)
    if (authorization?.type !== 'basic') {
      return reply
        .code(401)
        .header('www-authenticate', 'Basic')
        .sendError({ message: 'Unsupported auth scheme.' })
    }

    // Cache set after authentication AND authorization
    const result = await fastify.auth.authenticate(
      authorization.username,
      authorization.password,
    )
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
  ): Promise<RequestResult<string[]>> => {
    const response = await fastify.store.functions.adapter.scope.view<
      PartialFn[]
    >('default', 'registry', {
      group: true,
      key: [publicUrl.host, request.params.imageName],
      reduce: true,
      sorted: false,
    })

    // All projects with this image
    const partials = response.rows[0]?.value || []

    const allProjects: string[] = []
    for (const { project } of partials) {
      if (!allProjects.includes(project)) {
        allProjects.push(project)
      }
    }

    const authResults = await Promise.all(
      allProjects.map(p =>
        fastify.auth.authorize(request.session, 'publisher', p),
      ),
    )

    const okProjects = authResults.filter(r => r.isOk).map(r => r.unwrap())

    const fns = partials
      .filter(obj => okProjects.includes(obj.project))
      .map(obj => obj.name)

    if (!fns.length) {
      // No projects, no api :)
      return Result.err({ status: 404 })
    }

    return Result.ok(fns)
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
              .map(fnName =>
                patchImageTag(
                  request.session.username,
                  fnName,
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

export default plugin(registryPlugin, {
  name: 'registry',
  decorators: {
    fastify: ['store'],
  },
  encapsulate: true,
})
