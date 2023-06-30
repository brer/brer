import type { Invocation } from '@brer/types'
import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify'
import S from 'fluent-json-schema-es'
import { Readable } from 'node:stream'

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

    reply.type('text/html')
    return Readable.from(iterateLogs(this, invocation))
  },
}

async function* iterateLogs(
  { database }: FastifyInstance,
  invocation: Invocation,
): AsyncGenerator<Buffer> {
  if (invocation._attachments?.logs) {
    yield database.invocations.adapter.readAttachment(invocation, 'logs')
  } else {
    const log = await database.invocationLogs.find(invocation._id).unwrap()
    if (log) {
      for (const page of log.pages) {
        yield database.invocationLogs.adapter.readAttachment(
          log,
          page.attachment,
        )
      }
    }
  }

  // TODO: fetch live logs from k8s
}

export default route
