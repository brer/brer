import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

export default (): RouteOptions => ({
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
            .prop('type', S.string().enum(['basic', 'bearer', 'cookie']))
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
  async handler(request, reply) {
    const { auth } = this
    const { session } = request

    if (!session) {
      return { authenticated: false }
    }

    const result = await auth.getProjects(session.token.subject)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    return {
      authenticated: true,
      session: {
        type: session.type,
      },
      user: {
        username: session.token.subject,
        projects: result.unwrap(),
      },
    }
  },
})
