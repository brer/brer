import type { FastifyInstance } from '@brer/types'
import S from 'fluent-json-schema-es'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (fastify: FastifyInstance) =>
  fastify.route<RouteGeneric>({
    method: 'GET',
    url: '/api/v1/invocations/:invocationId/payload',
    schema: {
      tags: ['invocation'],
      params: S.object()
        .prop('invocationId', S.string().format('uuid'))
        .required(),
    },
    async handler(request, reply) {
      const { database } = this
      const { params } = request

      const invocation = await database.invocations
        .find(params.invocationId)
        .unwrap()
      if (!invocation) {
        return reply.code(404).error({ message: 'Invocation not found.' })
      }

      const attachment = invocation._attachments?.payload
      if (!attachment) {
        return reply.code(204).send()
      }

      const payload = await database.invocations.adapter.readAttachment(
        invocation,
        'payload',
      )

      reply.type(attachment.content_type || 'application/octet-stream')
      return payload
    },
  })
