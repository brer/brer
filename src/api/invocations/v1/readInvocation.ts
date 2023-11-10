import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/invocations/:invocationId',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      200: S.object()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { store } = this
    const { params } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
    }

    return { invocation }
  },
})
