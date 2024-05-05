import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { pushLogPage } from '../../lib/invocation.js'
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
    const { body, params } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      return reply.code(404).error()
    } else if (invocation.status !== 'running') {
      return reply.code(422).error({ message: 'Invalid Invocation status.' })
    }

    await store.invocations
      .from(invocation)
      .update(doc =>
        pushLogPage(doc, Buffer.from(body, 'utf-8'), params.pageIndex),
      )
      .unwrap()

    return reply.code(204).send()
  },
})
