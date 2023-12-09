import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/invoker/v1/invocations/:invocationId',
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

    return { invocation }
  },
})
