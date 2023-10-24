import type { FastifyContext, FastifyInstance } from '@brer/fastify'
import type { CookieSerializeOptions } from '@fastify/cookie'
import S from 'fluent-json-schema-es'

declare module 'fastify' {
  interface FastifyRequest {
    session: {
      type: 'basic' | 'cookie' | 'legacy'
      username: string
    }
  }
}

export default async function authPlugin(fastify: FastifyInstance) {
  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    throw new Error('Required env var ADMIN_PASSWORD is missing')
  }

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

  fastify.decorateRequest('session', null)

  fastify.addHook<any, FastifyContext>('onRequest', async (request, reply) => {
    const { cookies, headers } = request

    let message: string | undefined

    if (typeof headers.authorization === 'string') {
      if (/^Basic /.test(headers.authorization)) {
        const chunks = Buffer.from(headers.authorization.substring(6), 'base64')
          .toString('utf-8')
          .split(':')

        if (
          chunks.length === 2 &&
          chunks[0] === 'admin' &&
          chunks[1] === adminPassword
        ) {
          request.session = {
            type: 'basic',
            username: chunks[0],
          }
        } else {
          message = 'Invalid credentials.'
        }
      } else if (
        process.env.SECRET_TOKEN &&
        /^Bearer /.test(headers.authorization)
      ) {
        if (headers.authorization === `Bearer ${process.env.SECRET_TOKEN}`) {
          request.session = {
            type: 'legacy',
            username: 'admin',
          }
        } else {
          message = 'Invalid credentials.'
        }
      } else {
        message = 'Unsupported authorization scheme.'
      }
    } else {
      const raw = cookies[cookieName]
      if (raw) {
        const unsigned = fastify.unsignCookie(raw)
        if (unsigned.valid && unsigned.value === 'admin') {
          request.session = {
            type: 'cookie',
            username: unsigned.value,
          }
        } else {
          message = 'Session is not valid.'
        }
      }
    }

    if (!request.session && !request.routeConfig.public) {
      return reply.code(401).sendError({ message })
    }
  })

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
      if (body.username !== 'admin' || body.password !== adminPassword) {
        return reply.code(401).error({
          message: 'Invalid credentials.',
        })
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
              .prop('type', S.string().enum(['basic', 'cookie', 'legacy']))
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
