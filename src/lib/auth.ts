import type { FastifyInstance } from '@brer/fastify'
import type { ProjectRole } from '@brer/project'
import plugin from 'fastify-plugin'

import type { RequestResult } from './error.js'
import { getProjectByName } from './project.js'
import * as Result from './result.js'

declare module 'fastify' {
  interface FastifyInstance {
    auth: {
      authenticate(
        username: string,
        password: string,
      ): Promise<RequestResult<Session>>
      /**
       * Fetch a session by username (authentication must be already done).
       */
      fetch(username: string): Promise<RequestResult<Session>>
      /**
       * Resolves with the Project's name.
       */
      authorize(
        session: Session,
        role: ProjectRole,
        project: string,
      ): Promise<RequestResult<string>>
    }
  }
}

export interface Session {
  username: string
  /**
   * Projects with at least
   */
  projects: string[]
}

export interface PluginOptions {
  adminPassword?: string
  gatewayUrl?: URL
}

type Authenticator = (
  username: string,
  password: string,
) => Promise<RequestResult<string>>

async function authPlugin(
  fastify: FastifyInstance,
  { adminPassword, gatewayUrl }: PluginOptions,
) {
  const doAuthenticate = gatewayUrl
    ? useGateway(fastify, gatewayUrl, adminPassword)
    : adminPassword
      ? adminOnly(fastify, adminPassword)
      : undefined

  if (!doAuthenticate) {
    throw new Error('Both admin password and gateway URL are undefined')
  }

  const doFetch = async (username: string): Promise<RequestResult<Session>> => {
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
      ? Result.ok({ projects, username })
      : Result.err({ message: 'Insufficient permissions.', status: 403 })
  }

  const decorator: FastifyInstance['auth'] = {
    authenticate(username, password) {
      return doAuthenticate(username, password).then(result =>
        result.isOk ? doFetch(result.unwrap()) : result.expectErr(),
      )
    },
    fetch: doFetch,
    async authorize(session, requestedRole, projectName) {
      if (session.username === 'admin') {
        return Result.ok(projectName)
      }

      const project = await getProjectByName(fastify.store, projectName)
      const userRole = project?.roles[session.username] || 'none'

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
    },
  }

  fastify.decorate('auth', decorator)
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
): Authenticator {
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
): Authenticator {
  fastify.log.info(
    { gateway: gatewayUrl.origin },
    'using authentication gateway',
  )
  const pool = fastify.createPool(gatewayUrl, { pipelining: 1 })

  return async (username, password) => {
    if (adminPassword && username === 'admin' && password === adminPassword) {
      return Result.ok(username)
    }

    const response = await pool.request({
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
})
