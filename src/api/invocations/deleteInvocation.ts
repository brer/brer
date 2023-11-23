import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { deleteInvocation } from '../request.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'DELETE',
  url: '/api/v1/invocations/:invocationId',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      204: S.null(),
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

    const resAuth = await auth.authorize(session, 'admin', invocation.project)
    if (resAuth.isErr) {
      return reply.error(resAuth.unwrapErr())
    }

    const resDelete = await deleteInvocation(
      this,
      session.token,
      params.invocationId,
    )
    if (resDelete.isErr) {
      return reply.error(resAuth.unwrapErr())
    }

    return reply.code(204).send()
  },
})
