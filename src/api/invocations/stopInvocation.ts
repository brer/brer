import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { stopInvocation } from '../request.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'POST',
  url: '/api/v1/invocations/:invocationId/stop',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object(),
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

    const resAuth = await auth.authorize(session, 'invoker', invocation.project)
    if (resAuth.isErr) {
      return reply.code(403).error(resAuth.unwrapErr())
    }

    if (invocation.status === 'completed' || invocation.status === 'failed') {
      return reply.code(422).error({ message: 'Invocation not running.' })
    }

    const resStop = await stopInvocation(
      this,
      session.token,
      params.invocationId,
    )
    if (resStop.isErr) {
      return reply.code(422).error(resAuth.unwrapErr())
    }

    return { invocation: resStop.unwrap() }
  },
})
