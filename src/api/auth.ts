import type { FastifyContext, FastifyInstance } from '@brer/fastify'
import type { ProjectRole } from '@brer/project'
import { type CookieSerializeOptions } from '@fastify/cookie'
import plugin from 'fastify-plugin'

import { type RequestResult } from '../lib/error.js'
import { parseAuthorization } from '../lib/header.js'
import { getProjectByName } from '../lib/project.js'
import * as Result from '../lib/result.js'
import {
  API_ISSUER,
  type Token,
  signApiToken,
  verifyToken,
} from '../lib/token.js'

declare module 'fastify' {
  interface FastifyInstance {
    auth: {
      /**
       * Perform standard credentials authentication.
       */
      authenticate(username: string, password: string): Promise<RequestResult>
      /**
       * Check User's authorization for a Project.
       */
      authorize(
        session: ApiSession,
        role: ProjectRole,
        project: string,
      ): Promise<RequestResult<string>>
      /**
       * Get User's Projects.
       */
      getProjects(username: string): Promise<RequestResult<string[]>>
    }
  }
  interface FastifyRequest {
    session: ApiSession
  }
}

export interface ApiSession {
  type: 'basic' | 'bearer' | 'cookie'
  token: Token
}

interface TokenSession {
  type: 'basic' | 'bearer' | 'cookie'
  token: string
}

export interface PluginOptions {
  adminPassword?: string
  gatewayUrl?: URL
  cookieName: string
  cookieOptions?: CookieSerializeOptions
}

type AuthenticateMethod = FastifyInstance['auth']['authenticate']

async function authPlugin(
  fastify: FastifyInstance,
  { adminPassword, cookieName, cookieOptions, gatewayUrl }: PluginOptions,
) {
  const authenticate = gatewayUrl
    ? useGateway(fastify, gatewayUrl, adminPassword)
    : adminPassword
      ? adminOnly(fastify, adminPassword)
      : null

  if (!authenticate) {
    throw new Error('Both admin password and gateway URL are undefined')
  }

  const authorize = async (
    session: ApiSession,
    requestedRole: ProjectRole,
    projectName: string,
  ): Promise<RequestResult<string>> => {
    if (session.token.subject === 'admin') {
      return Result.ok(projectName)
    }

    const project = await getProjectByName(fastify.store, projectName)
    const userRole = project?.roles[session.token.subject] || 'none'

    if (isAuthorized(requestedRole, userRole)) {
      return Result.ok(projectName)
    } else {
      return Result.err({
        message: 'Insufficient permissions.',
        info: {
          role: userRole,
          project: projectName,
        },
        status: 403,
      })
    }
  }

  const getProjects = async (
    username: string,
  ): Promise<RequestResult<string[]>> => {
    const response = await fastify.store.projects.adapter.scope.view<string[]>(
      'default',
      'by_user',
      {
        group: true,
        key: username,
        reduce: true,
        sorted: false,
      },
    )

    let projects = response.rows?.[0]?.value || []
    if (username === 'admin' && projects.length <= 0) {
      projects = ['default']
    }

    return projects.length
      ? Result.ok(projects)
      : Result.err({ message: 'Insufficient permissions.', status: 403 })
  }

  /**
   * Set `request.session` value.
   */
  fastify.addHook<any, FastifyContext>('onRequest', async (request, reply) => {
    const authorization = parseAuthorization(request.headers)

    if (authorization?.type === 'basic') {
      const authenticated = await fastify.auth.authenticate(
        authorization.username,
        authorization.password,
      )
      if (authenticated.isErr) {
        return reply.code(401).sendError(authenticated.unwrapErr())
      }

      // Replace raw credentials with a token
      // Other services will not accept raw credentials
      request.session = {
        type: 'basic',
        token: await signApiToken(authorization.username),
      }
      return
    }

    const items: TokenSession[] = []
    if (authorization?.type === 'bearer') {
      items.push({
        type: 'bearer',
        token: authorization.token,
      })
    }
    if (request.cookies[cookieName]) {
      items.push({
        type: 'cookie',
        token: request.cookies[cookieName]!,
      })
    }

    for (const { token, type } of items) {
      if (!request.session) {
        try {
          request.session = {
            type,
            token: await verifyToken(
              token,
              API_ISSUER,
              request.routeOptions.config.admin
                ? API_ISSUER
                : request.routeOptions.config.tokenIssuer || API_ISSUER,
            ),
          }
        } catch (err) {
          request.log.debug({ type, err }, 'token verification failed')
          if (type === 'cookie') {
            reply.clearCookie(cookieName, cookieOptions)
          }
        }
      }
    }
  })

  /**
   * Apply authentication rules.
   */
  fastify.addHook<any, FastifyContext>('onRequest', async (request, reply) => {
    const adminOnly = !!request.routeOptions.config.admin
    const optionalAuth = !adminOnly && !!request.routeOptions.config.public

    if (!optionalAuth && !request.session) {
      return reply.code(401).sendError()
    } else if (adminOnly && request.session.token.subject !== 'admin') {
      return reply.code(403).sendError({ message: 'Insufficient permissions.' })
    }
  })

  fastify.decorate('auth', {
    authenticate,
    authorize,
    getProjects,
  })
  fastify.decorateRequest('session', null)
}

function isAuthorized(
  requestedRole: ProjectRole,
  userRole: ProjectRole | 'none' | undefined,
): boolean {
  switch (requestedRole) {
    case 'admin':
      return userRole === 'admin'
    case 'invoker':
      return userRole === 'admin' || userRole == 'invoker'
    case 'publisher':
      return userRole === 'admin' || userRole === 'publisher'
    case 'viewer':
      return (
        userRole === 'admin' || userRole === 'invoker' || userRole === 'viewer'
      )
  }
}

function adminOnly(
  { log }: FastifyInstance,
  adminPassword: string,
): AuthenticateMethod {
  log.info('admin-only mode active')
  return async (username, password) => {
    if (username !== 'admin') {
      log.warn('only admin user can be authenticated without a gateway')
    }
    if (username === 'admin' && password === adminPassword) {
      return Result.ok(username)
    } else {
      return Result.err({
        message: 'Invalid credentials',
        status: 401,
      })
    }
  }
}

function useGateway(
  fastify: FastifyInstance,
  gatewayUrl: URL,
  adminPassword: string | undefined,
): AuthenticateMethod {
  fastify.log.info(
    { gateway: gatewayUrl.origin },
    'using authentication gateway',
  )
  const gateway = fastify.pools.set('gateway', gatewayUrl)

  return async (username, password) => {
    if (adminPassword && username === 'admin' && password === adminPassword) {
      return Result.ok(username)
    }

    const response = await gateway.request({
      method: 'POST',
      path: gatewayUrl.pathname,
      headers: {
        accept: '*/*',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        username,
        password,
      }),
    })

    const text = await response.body.text()
    fastify.log.trace(
      { statusCode: response.statusCode, body: text },
      'gateway response',
    )

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return Result.ok(username)
    } else if (response.statusCode === 401 || response.statusCode === 403) {
      return Result.err({
        message: 'Invalid credentials',
        status: 401,
      })
    } else {
      fastify.log.error(
        {
          statusCode: response.statusCode,
          body: text,
        },
        'gateway error',
      )
      return Result.err({
        message: 'Unexpected authentication gateway response. See logs.',
        info: { statusCode: response.statusCode },
        status: 409,
      })
    }
  }
}

export default plugin(authPlugin, {
  name: 'auth',
  decorators: {
    fastify: ['pools'],
    request: ['cookies'],
  },
})
