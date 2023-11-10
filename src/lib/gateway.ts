import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'
import { Pool } from 'undici'

import type { RequestResult } from './error.js'
import * as Result from './result.js'

declare module 'fastify' {
  interface FastifyInstance {
    gateway: {
      /**
       * Authenticate a User.
       * Resolves with the username.
       */
      authenticate(
        username: string,
        password: string,
      ): Promise<RequestResult<string>>
      /**
       * Authorize a User action (identified by role) for a particular group.
       */
      authorize(
        username: string,
        role: Role,
        scope: Scope,
      ): Promise<RequestResult<Scope>>
    }
  }
}

export type Role = 'api_read' | 'api_write' | 'registry_read' | 'registry_write'

/**
 * List of groups or `null` to request all groups.
 * An empty list result is requesting access to no group (forbidden by default).
 */
export type Scope = string[] | null

async function gatewayPlugin(fastify: FastifyInstance) {
  let decorator: FastifyInstance['gateway'] | undefined
  if (process.env.GATEWAY_URL) {
    decorator = getRemoteGatewayDecorator(
      fastify,
      new URL(process.env.GATEWAY_URL),
    )
  } else if (process.env.ADMIN_PASSWORD) {
    decorator = getAdminOnlyDecorator(process.env.ADMIN_PASSWORD)
  }

  if (!decorator) {
    throw new Error('Gateway plugin not ready')
  }
  fastify.decorate('gateway', decorator)
}

function getAdminOnlyDecorator(
  adminPassword: string,
): FastifyInstance['gateway'] {
  return {
    async authenticate(username, password) {
      if (username === 'admin' && password === adminPassword) {
        return Result.ok('admin')
      } else {
        return Result.err({ message: 'Invalid credentials.' })
      }
    },
    async authorize(username, role, scope) {
      if (username === 'admin') {
        return Result.ok(scope)
      } else {
        return Result.err({
          message: 'Access to scope forbidden.',
          info: {
            role,
            scope,
          },
        })
      }
    },
  }
}

function getRemoteGatewayDecorator(
  fastify: FastifyInstance,
  gatewayUrl: URL,
): FastifyInstance['gateway'] {
  const pool = new Pool(gatewayUrl.origin, {
    connections: 32,
    pipelining: 1,
  })

  fastify.addHook('onClose', () => pool.close())

  const doRequest = async (path: string, body: any) => {
    const response = await pool.request({
      method: 'POST',
      path,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    })

    const text = await response.body.text()
    return {
      response,
      text,
    }
  }

  const authenticatePath = new URL('authenticate', gatewayUrl).pathname
  const authorizePath = new URL('authorize', gatewayUrl).pathname

  return {
    async authenticate(username, password) {
      const { response, text } = await doRequest(authenticatePath, {
        username,
        password,
      })

      if (response.statusCode === 200) {
        return parseObject(text, 'authenticate').map(() => username)
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        return Result.err({ message: 'Invalid credentials.' })
      } else {
        return Result.err({
          message: 'Gateway error.',
          info: {
            action: 'authenticate',
            response: text,
            status: response.statusCode,
          },
        })
      }
    },
    async authorize(username, role, scope) {
      if (scope && scope.length) {
        // Scope is defined, but without groups.
        // No need to make authorization request.
        return Result.err({
          message: 'Permission denied.',
          info: {
            role,
            scope,
          },
        })
      }

      const { response, text } = await doRequest(authorizePath, {
        username,
        role,
        scope,
      })

      if (response.statusCode === 200) {
        if (scope) {
          // When defined, requested scope cannot be changed
          return Result.ok(scope)
        } else {
          return parseObject(text, 'authorize').andThen(parseScope)
        }
      }

      if (response.statusCode === 200) {
        return Result.err({
          message: 'Unexpected gateway response.',
          info: {
            action: 'authorize',
            response: text,
          },
        })
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        return Result.err({
          message: 'Permission denied.',
          info: {
            role,
            scope,
          },
        })
      } else {
        return Result.err({
          message: 'Gateway error.',
          info: {
            action: 'authorize',
            response: text,
            status: response.statusCode,
          },
        })
      }
    },
  }
}

function parseObject(
  text: string,
  action: string,
): RequestResult<Record<string, unknown>> {
  let obj: any
  let reason: string | undefined
  try {
    obj = JSON.parse(text)
  } catch (err) {
    reason = '' + (Object(err).message || err)
  }
  if (typeof obj === 'object' && obj !== null) {
    return Result.ok(obj)
  }
  return Result.err({
    message: 'Unexpected gateway response.',
    info: {
      action,
      response: text,
      reason,
    },
  })
}

function parseScope({ scope }: Record<string, unknown>): RequestResult<Scope> {
  if (scope === null) {
    return Result.ok(scope)
  }
  if (Array.isArray(scope) && !scope.some(item => typeof item !== 'string')) {
    if (scope.length) {
      return Result.ok(scope)
    } else {
      // It should have been a 401/403 response
      return Result.err({ message: 'Permission denied.' })
    }
  }
  return Result.err({
    message: 'Unexpected gateway response.',
    info: {
      action: 'authorize',
      response: { scope },
    },
  })
}

export default plugin(gatewayPlugin, {
  name: 'gateway',
})
