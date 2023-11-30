import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { completeInvocation } from '../../lib/invocation.js'
import { handleTestInvocation } from '../lib.js'

export interface RouteGeneric {
  Body: {
    result?: unknown
  }
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/invoker/v1/invocations/:invocationId/status/completed',
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object().prop('result'),
  },
  async handler(request, reply) {
    const { store } = this
    const { body, params, token } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .update(doc =>
        doc.tokenId === token.id && doc.status === 'running'
          ? completeInvocation(doc, body.result)
          : doc,
      )
      .unwrap()

    if (!invocation) {
      return reply.code(404).error()
    } else if (invocation.tokenId !== token.id) {
      return reply.code(403).error({ message: 'Token invalidated.' })
    } else if (invocation.status !== 'completed') {
      return reply.code(409).error({ message: 'Invalid Invocation status.' })
    }

    await handleTestInvocation(this, invocation, token)

    return { invocation }
  },
})
