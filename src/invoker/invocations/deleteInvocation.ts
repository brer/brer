import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { API_ISSUER } from '../../lib/token.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'DELETE',
  url: '/invoker/v1/invocations/:invocationId',
  config: {
    tokenIssuer: API_ISSUER,
  },
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object(),
  },
  async handler(request, reply) {
    const { helmsman, store } = this
    const { params } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      return reply.code(404).error()
    }

    await Promise.all([
      store.invocations.from(invocation).delete().consume(),
      helmsman.deleteInvocationPods(params.invocationId),
    ])

    return reply.code(204).send()
  },
})
