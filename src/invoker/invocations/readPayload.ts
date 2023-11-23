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
  url: '/invoker/v1/invocations/:invocationId/payload',
  config: {
    tokenIssuer: API_ISSUER,
  },
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
  },
  async handler(request, reply) {
    const { store } = this
    const { params } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      return reply.code(404).error()
    }

    const attachment = invocation?._attachments?.payload
    if (!attachment) {
      return reply.code(204).send()
    }

    const buffer = await store.invocations.adapter.scope.attachment.get(
      invocation._id,
      'payload',
    )

    reply.type(attachment.content_type || 'application/octet-stream')
    return buffer
  },
})
