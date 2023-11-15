import type { FastifyInstance } from '@brer/fastify'
import type { ProjectRole } from '@brer/project'
import plugin from 'fastify-plugin'

import type { RequestResult } from './error.js'
import { verifySecret } from './hash.js'
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
       * Resolves with the project name.
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

async function authPlugin(fastify: FastifyInstance) {
  const doAuthenticate = async (
    username: string,
    password: string,
  ): Promise<RequestResult<string>> => {
    const user = await fastify.store.users
      .find({
        _design: 'default',
        _view: 'by_username',
        key: username,
      })
      .unwrap()

    if (user) {
      const ok = await verifySecret(password, user.hashedPassword)
      if (ok) {
        return Result.ok(username)
      }
    } else if (
      username === 'admin' &&
      password === process.env.ADMIN_PASSWORD
    ) {
      return Result.ok(username)
    }

    return Result.err({
      message: 'Invalid credentials',
      status: 401,
    })
  }

  const doFetch = async (username: string): Promise<RequestResult<Session>> => {
    const response = await fastify.store.projects.adapter.nano.view<string[]>(
      'default',
      'by_username',
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
      : Result.err({ message: 'Permission denied.', status: 403 })
  }

  const decorator: FastifyInstance['auth'] = {
    authenticate(username, password) {
      return doAuthenticate(username, password).then(result =>
        result.isOk ? doFetch(result.unwrap()) : result.expectErr(),
      )
    },
    fetch: doFetch,
    async authorize(session, role, project) {
      if (session.username === 'admin') {
        return Result.ok(project)
      }

      const doc = await fastify.store.projects
        .find({
          _design: 'default',
          _view: 'by_name',
          key: project,
        })
        .unwrap()

      if (isAuthorized(role, doc?.roles[session.username])) {
        return Result.ok(project)
      } else {
        return Result.err({
          message: 'Permission denied.',
          info: {
            role,
            project,
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
  userRole: ProjectRole | undefined,
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

export default plugin(authPlugin, {
  name: 'auth',
})
