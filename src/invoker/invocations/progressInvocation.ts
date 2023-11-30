import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { progressInvocation } from '../../lib/invocation.js'
import { isOlderThan, tail } from '../../lib/util.js'

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
  url: '/invoker/v1/invocations/:invocationId/status/progress',
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object().prop('result'),
  },
  async handler(request, reply) {
    const { store } = this
    const { body, params, token } = request

    const oldInvocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!oldInvocation) {
      return reply.code(404).error()
    } else if (oldInvocation.tokenId !== token.id) {
      return reply.code(403).error({ message: 'Token invalidated.' })
    } else if (oldInvocation.status !== 'running') {
      return reply.code(409).error({ message: 'Invalid Invocation status.' })
    } else if (!isOlderThan(tail(oldInvocation.phases)!.date, 2)) {
      return reply.code(409).error({
        message: 'Cannot progress an Invocation too quickly.',
      })
    }

    const newInvocation = await store.invocations
      .from(oldInvocation)
      .update(doc => progressInvocation(doc, body.result))
      .unwrap()

    return { invocation: newInvocation }
  },
})
