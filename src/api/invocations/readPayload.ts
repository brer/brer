import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/invocations/:invocationId/payload',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
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

    const result = await auth.authorize(session, 'viewer', invocation.project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    const attachment = invocation._attachments?.payload
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
