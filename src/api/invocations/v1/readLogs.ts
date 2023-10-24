import type { FastifyInstance, RouteOptions } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import S from 'fluent-json-schema-es'
import { Readable } from 'node:stream'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
  Querystring: {
    // TODO: those params and HEAD route
    limitBytes?: number
    skipBytes?: number
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/invocations/:invocationId/logs',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .additionalProperties(false)
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

    reply.type('text/plain; charset=utf-8')
    return Readable.from(iterateLogs(this, invocation))
  },
})

async function* iterateLogs(
  { database }: FastifyInstance,
  invocation: Invocation,
): AsyncGenerator<Buffer> {
  if (invocation.logs) {
    for (const item of invocation.logs) {
      yield database.invocations.adapter.readAttachment(
        invocation,
        item.attachment,
      )
    }
  }
}
