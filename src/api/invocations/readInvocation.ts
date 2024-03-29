import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { API_ISSUER } from '../../lib/token.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/invocations/:invocationId',
  config: {
    tokenIssuer: API_ISSUER,
  },
  schema: {
    tags: ['invocation'],
    params: S.object()
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      200: S.object()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { auth, store } = this
    const { params, session } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()
    if (!invocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
    }

    const result = await auth.authorize(session, 'viewer', invocation.project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    return { invocation }
  },
})
