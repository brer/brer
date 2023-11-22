import type {
  FastifyContext,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  FastifySchema,
} from '@brer/fastify'
import type { CookieSerializeOptions } from '@fastify/cookie'
import S from 'fluent-json-schema-es'

import { type Session } from '../lib/auth.js'
import { type RequestResult } from '../lib/error.js'
import { parseAuthorization } from '../lib/header.js'
import * as Result from '../lib/result.js'
import { signUserToken, verifyToken } from '../lib/token.js'

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

export default async function apiAuthPlugin(fastify: FastifyInstance) {
  const cookieName = process.env.COOKIE_NAME || 'brer_session'

  const cookieOptions: CookieSerializeOptions = {
    domain: process.env.COOKIE_DOMAIN,
    httpOnly: true,
    maxAge: 600, // 10 minutes (seconds)
    path: '/',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    signed: false,
  }

  const getRequestSession = async (
    request: FastifyRequest<any>,
    reply: FastifyReply,
  ): Promise<RequestResult<FastifyRequest['session']>> => {
    const authorization = parseAuthorization(request.headers)

    if (authorization?.type === 'basic') {
      return fastify.auth
        .authenticate(authorization.username, authorization.password)
        .then(result => result.map(session => ({ ...session, type: 'basic' })))
    }

    const cookie = request.cookies[cookieName]
    const token =
      authorization?.type === 'bearer' ? authorization.token : cookie

    let username: string | undefined
    if (token) {
      try {
        const { subject } = await verifyToken(
          token,
          'brer.io/api',
          request.routeOptions.config.tokenIssuer || 'brer.io/api',
        )
        username = subject
      } catch (err) {
        request.log.debug({ err }, 'jwt verification failed')
        if (cookie) {
          reply.clearCookie(cookieName, cookieOptions)
        }
      }
    }
    if (username) {
      return fastify.auth
        .fetch(username)
        .then(result => result.map(session => ({ ...session, type: 'cookie' })))
    }

    return Result.err({
      message: 'Usupported authorization scheme.',
      status: 401,
    })
  }

  fastify.decorateRequest('session', null)

  fastify.addHook<any, FastifyContext, FastifySchema>(
    'onRequest',
    async (request, reply) => {
      const adminOnly = !!request.routeOptions.config.admin
      const optionalAuth = !adminOnly && !!request.routeOptions.config.public

      const result = await getRequestSession(request, reply)

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
      const token = await signUserToken(session.username)

      reply.setCookie(cookieName, token.raw, cookieOptions)
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
