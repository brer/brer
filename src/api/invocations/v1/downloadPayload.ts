import type { FastifyRequest, RouteOptions } from 'fastify'
import S from 'fluent-json-schema-es'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

const route: RouteOptions = {
  method: 'GET',
  url: '/api/v1/invocations/:invocationId/payload',
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      404: S.object()
        .prop('error', S.ref('https://brer.io/schema/v1/error.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { database } = this
    const { params } = request as FastifyRequest<RouteGeneric>

    const invocation = await database.invocations
      .find(params.invocationId)
      .unwrap()

    const attachment = invocation?._attachments?.payload
    if (!attachment) {
      return reply.code(404).error()
    }

    const payload = await database.invocations.adapter.readAttachment(
      invocation,
      'payload',
    )

    reply.type(attachment.content_type!)
    return payload
  },
}

export default route
