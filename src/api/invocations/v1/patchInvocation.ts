import type { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'

import {
  PatchInvocationOptions,
  patchInvocation,
} from '../../invocations/lib/invocation.js'

interface RouteGeneric {
  Body: PatchInvocationOptions
  Params: {
    invocationId: string
  }
}

const route: RouteOptions = {
  method: 'PATCH',
  url: '/api/v1/invocations/:invocationId',
  schema: {
    params: S.object()
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object()
      .additionalProperties(false)
      .prop('status', S.string().enum(['running', 'completed', 'failed']))
      .description('The desired status for this Invocation.')
      .prop('result')
      .description(
        'Invocation result value. Useful only with the "completed" status.',
      )
      .prop('reason')
      .description(
        'Invocation error reason. Useful only with the "failed" status.',
      ),
    response: {
      200: S.object()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json'))
        .required(),
      404: S.object()
        .prop('error', S.ref('https://brer.io/schema/v1/error.json'))
        .required(),
      409: S.object()
        .prop('error', S.ref('https://brer.io/schema/v1/error.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { database } = this
    const { body, params } = request as FastifyRequest<RouteGeneric>

    let invocation = await database.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      return reply.code(404).error()
    }

    invocation = await database.invocations
      .from(invocation)
      .update(doc => patchInvocation(doc, body))
      .unwrap()

    return { invocation }
  },
}

export default route
