import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { putLogPage } from '../../lib/invocation.js'
import { asInteger } from '../../lib/qs.js'

export interface RouteGeneric {
  Body: string
  Params: {
    invocationId: string
    pageIndex: number
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/invoker/v1/invocations/:invocationId/log/:pageIndex',
  config: {
    tokenIssuer: 'brer.io/invoker',
  },
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required()
      .prop('pageIndex', S.integer().minimum(0))
      .required(),
    body: S.string(),
  },
  async preValidation(request) {
    request.params.pageIndex = asInteger(request.params.pageIndex)
  },
  async handler(request, reply) {
    const { store } = this
    const { body, params, token } = request

    const buffer = Buffer.from(body, 'utf-8')

    const invocation = await store.invocations
      .find(params.invocationId)
      .update(doc =>
        doc.tokenId === token.id && doc.status === 'running'
          ? putLogPage(doc, buffer, params.pageIndex)
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
