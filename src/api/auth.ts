import type {
  FastifyContext,
  FastifyInstance,
  FastifyRequest,
  FastifySchema,
} from '@brer/fastify'
import type { CookieSerializeOptions } from '@fastify/cookie'
import S from 'fluent-json-schema-es'

import { type Session } from '../lib/auth.js'
import { type RequestResult } from '../lib/error.js'
import { parseAuthorization } from '../lib/header.js'
import * as Result from '../lib/result.js'

declare module 'fastify' {
  interface FastifyRequest {
    session: Session & {
      /**
       * Session type.
       */
      type: 'basic' | 'cookie'
    }
  }
}

export default async function authPlugin(fastify: FastifyInstance) {
  const cookieName = process.env.COOKIE_NAME || 'brer_session'

  const cookieOptions: CookieSerializeOptions = {
    domain: process.env.COOKIE_DOMAIN,
    httpOnly: true,
    maxAge: 600, // 10 minutes (seconds)
    path: '/',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    signed: true,
  }

  const getRequestSession = async (
    request: FastifyRequest<any>,
  ): Promise<RequestResult<FastifyRequest['session']>> => {
    const { cookies, headers } = request
    const rawCookie = cookies[cookieName]
    const authorization = parseAuthorization(headers)

    let session: FastifyRequest['session'] | undefined
    if (authorization?.type === 'basic') {
      const result = await fastify.auth.authenticate(
        authorization.username,
        authorization.password,
      )
      if (result.isErr) {
        return result.expectErr()
      } else {
        session = {
          ...result.unwrap(),
          type: 'basic',
        }
      }
    } else if (rawCookie) {
      const unsigned = fastify.unsignCookie(rawCookie)
      if (unsigned.valid && unsigned.value) {
        const { username } = JSON.parse(
          Buffer.from(unsigned.value, 'base64').toString(),
        )

        const result = await fastify.auth.fetch(username)
        if (result.isErr) {
          return result.expectErr()
        } else {
          session = {
            ...result.unwrap(),
            type: 'cookie',
          }
        }
      }
    }

    if (session) {
      return Result.ok(session)
    } else {
      return Result.err({
        message: 'Invalid credentials.',
        status: 401,
      })
    }
  }

  fastify.decorateRequest('session', null)

  fastify.addHook<any, FastifyContext, FastifySchema>(
    'onRequest',
    async (request, reply) => {
      const adminOnly = !!request.routeOptions.config.admin
      const optionalAuth =
        !adminOnly && (request.routeOptions.config.public || false)

      const result = await getRequestSession(request)

      if (result.isErr && optionalAuth) {
        request.log.trace('optional authentication failed')
      } else if (result.isErr) {
        return reply.sendError(result.unwrapErr())
      } else {
        const session = result.unwrap()
        if (adminOnly && session.username !== 'admin') {
          return reply.sendError({
            message: 'Insufficient permissions.',
            status: 403,
          })
        } else {
          request.session = session
        }
      }
    },
  )

  interface RouteGeneric {
    Body: {
      username: string
      password: string
    }
  }

  fastify.route<RouteGeneric, FastifyContext>({
    method: 'POST',
    url: '/api/session',
    config: {
      public: true,
    },
    schema: {
      body: S.object()
        .additionalProperties(false)
        .prop('username', S.string())
        .required()
        .prop('password', S.string())
        .required(),
      response: {
        200: S.object()
          .additionalProperties(false)
          .prop(
            'user',
            S.object()
              .additionalProperties(false)
              .prop('username', S.string())
              .required()
              .prop('projects', S.array().items(S.string()))
              .required(),
          )
          .required(),
      },
    },
    async handler(request, reply) {
      const { body } = request

      const result = await this.auth.authenticate(body.username, body.password)
      if (result.isErr) {
        return reply.error(result.unwrapErr())
      }

      const session = result.unwrap()
      const content = Buffer.from(
        JSON.stringify({
          date: Date.now(),
          username: session.username,
        }),
      ).toString('base64')

      reply.setCookie(cookieName, content, cookieOptions)
      return {
        user: {
          username: session.username,
          projects: session.projects,
        },
      }
    },
  })

  fastify.route<any, FastifyContext>({
    method: 'GET',
    url: '/api/session',
    config: {
      public: true,
    },
    schema: {
      response: {
        200: S.object()
          .additionalProperties(false)
          .prop('authenticated', S.boolean())
          .required()
          .prop(
            'session',
            S.object()
              .additionalProperties(false)
              .prop('type', S.string().enum(['basic', 'cookie']))
              .required(),
          )
          .prop(
            'user',
            S.object()
              .additionalProperties(false)
              .prop('username', S.string())
              .required()
              .prop('projects', S.array().items(S.string()))
              .required(),
          ),
      },
    },
    async handler(request) {
      const user = request.session
        ? {
            username: request.session.username,
            projects: request.session.projects,
          }
        : undefined

      const session = request.session
        ? { type: request.session.type }
        : undefined

      return {
        authenticated: !!user,
        session,
        user,
      }
    },
  })
}
