import type {
  FastifyContext,
  FastifyInstance,
  FastifyRequest,
  FastifySchema,
} from '@brer/fastify'
import type { CookieSerializeOptions } from '@fastify/cookie'
import S from 'fluent-json-schema-es'

import { parseAuthorizationHeader } from '../lib/auth.js'
import type { RequestResult } from '../lib/error.js'
import * as Result from '../lib/result.js'

declare module 'fastify' {
  interface FastifyRequest {
    session: {
      type: 'basic' | 'bearer' | 'cookie'
      username: string
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
    const auth = parseAuthorizationHeader(headers.authorization)

    let username: string | undefined
    if (auth?.type === 'basic') {
      const result = await fastify.gateway.authenticate(
        auth.username,
        auth.password,
      )
      if (result.isErr) {
        return result.expectErr()
      } else {
        username = result.unwrap()
      }
    } else if (rawCookie) {
      const unsigned = fastify.unsignCookie(rawCookie)
      if (unsigned.valid && unsigned.value) {
        username = unsigned.value
      }
    }

    if (username) {
      return Result.ok({
        type: auth?.type || 'cookie',
        username,
      })
    } else {
      return Result.err({ message: 'Invalid credentials.' })
    }
  }

  fastify.decorateRequest('session', null)

  fastify.addHook<any, FastifyContext, FastifySchema>(
    'onRequest',
    async (request, reply) => {
      const optionalAuth = request.routeOptions.config.public || false
      const result = await getRequestSession(request)

      if (result.isErr && optionalAuth) {
        request.log.trace('optional authentication failed')
      } else if (result.isErr) {
        return reply.code(401).sendError(result.unwrapErr())
      } else {
        request.session = result.unwrap()
      }
    },
  )

  fastify.route<
    {
      Body: {
        username: string
        password: string
      }
    },
    FastifyContext
  >({
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
              .required(),
          )
          .required(),
      },
    },
    async handler(request, reply) {
      const { body } = request

      const result = await this.gateway.authenticate(
        body.username,
        body.password,
      )
      if (result.isErr) {
        return reply.code(401).error(result.unwrapErr())
      }

      reply.setCookie(cookieName, body.username, cookieOptions)
      return {
        user: {
          username: body.username,
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
              .required(),
          ),
      },
    },
    async handler(request) {
      const user = request.session
        ? { username: request.session.username }
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
