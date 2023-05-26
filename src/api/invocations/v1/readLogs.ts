import type { FastifyRequest, RouteOptions } from 'fastify'
import S from 'fluent-json-schema-es'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

const route: RouteOptions = {
  method: 'GET',
  url: '/api/v1/invocations/:invocationId/logs',
  schema: {
    params: S.object()
      .additionalProperties(false)
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

    if (!invocation) {
      return reply.code(404).error()
    }

    let logs = Buffer.from('')
    if (invocation._attachments?.logs) {
      logs = await database.invocations.adapter.readAttachment(
        invocation,
        'logs',
      )
    }

    reply.type('text/html')
    return logs
  },
}

export default route
