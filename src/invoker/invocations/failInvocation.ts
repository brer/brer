import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { failInvocation } from '../../lib/invocation.js'
import { handleTestInvocation, rotateInvocations } from '../lib.js'

export interface RouteGeneric {
  Body: {
    reason?: unknown
  }
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/invoker/v1/invocations/:invocationId/status/failed',
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object().prop('kill', S.boolean()).prop('reason'),
  },
  async handler(request, reply) {
    const { helmsman, store } = this
    const { body, params, token } = request

    const oldInvocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!oldInvocation) {
      return reply.code(404).error()
    } else if (oldInvocation.status === 'completed') {
      return reply.code(409).error({ message: 'Invalid Invocation status.' })
    } else if (oldInvocation.status === 'failed') {
      return { invocation: oldInvocation }
    } else if (
      token.issuer === 'brer.io/invoker' &&
      oldInvocation.tokenId !== token.id
    ) {
      return reply.code(403).error({ message: 'Token invalidated.' })
    }

    const newInvocation = await store.invocations
      .from(oldInvocation)
      .update(doc => failInvocation(doc, body.reason))
      .unwrap()

    await Promise.all([
      handleTestInvocation(store, newInvocation),
      helmsman.deleteInvocationPods(newInvocation._id),
      rotateInvocations(this, newInvocation.functionName),
    ])

    return { invocation: newInvocation }
  },
})
