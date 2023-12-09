import type { RouteOptions } from '@brer/fastify'
import { type CookieSerializeOptions } from '@fastify/cookie'
import S from 'fluent-json-schema-es'

export interface RouteGeneric {
  Body: {
    username: string
    password: string
  }
}

export default (
  cookieName: string,
  cookieOptions?: CookieSerializeOptions,
): RouteOptions<RouteGeneric> => ({
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
      201: S.object()
        .additionalProperties(false)
        .prop('authenticated', S.boolean().const(true))
        .required()
        .prop(
          'session',
          S.object()
            .additionalProperties(false)
            .prop('type', S.string().const('cookie'))
            .required(),
        )
        .required()
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
    const { auth } = this
    const { body } = request

    const result = await this.auth.authenticate(body.username, body.password)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    const [token, projects] = await Promise.all([
      this.token.signApiToken(body.username),
      auth.getProjects(body.username),
    ])

    reply.code(201)
    reply.setCookie(cookieName, token.raw, cookieOptions)
    return {
      authenticated: true,
      session: {
        type: 'cookie',
      },
      user: {
        username: body.username,
        projects,
      },
    }
  },
})
