import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { runInvocation } from '../../lib/invocation.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/invoker/v1/invocations/:invocationId/status/running',
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object(),
  },
  async handler(request, reply) {
    const { store } = this
    const { params, token } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .update(doc =>
        doc.tokenId === token.id && doc.status === 'initializing'
          ? runInvocation(doc)
          : doc,
      )
      .unwrap()

    if (!invocation) {
      return reply.code(404).error()
    } else if (invocation.tokenId !== token.id) {
      return reply.code(403).error({ message: 'Token invalidated.' })
    } else if (invocation.status !== 'running') {
      return reply.code(409).error({ message: 'Invalid Invocation status.' })
    }

    return { invocation }
  },
})
