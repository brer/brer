import type { FastifyInstance, RouteOptions } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import S from 'fluent-json-schema-es'
import { Readable } from 'node:stream'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
  Querystring: {
    // TODO: those params and HEAD route (keep in mind the utf8 thing)
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

    reply.type('text/plain; charset=utf-8')
    return Readable.from(iterateLogs(this, invocation))
  },
})

async function* iterateLogs(
  { store }: FastifyInstance,
  invocation: Invocation,
): AsyncGenerator<Buffer> {
  if (invocation.logs) {
    for (const item of invocation.logs) {
      yield store.invocations.adapter.scope.attachment.get(
        invocation._id,
        item.attachment,
      )
    }
  }
}
