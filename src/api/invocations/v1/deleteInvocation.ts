import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

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
    const { auth, helmsman, store } = this
    const { params, session } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()
    if (!invocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
    }

    const result = await auth.authorize(session, 'admin', invocation.project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    await store.invocations.from(invocation).delete().unwrap()

    await helmsman.deleteInvocationPods(invocation._id)

    return reply.code(204).send()
  },
})
