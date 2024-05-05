import type { RouteOptions } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import S from 'fluent-json-schema-es'
import Result, { type IResult } from 'ultres'

import { type ErrorOptions } from '../../lib/error.js'
import {
  completeInvocation,
  failInvocation,
  progressInvocation,
  runInvocation,
} from '../../lib/invocation.js'
import { API_ISSUER, INVOKER_ISSUER } from '../../lib/tokens.js'
import { isOlderThan } from '../../lib/util.js'

export interface RouteGeneric {
  Body: {
    status: 'running' | 'completed' | 'failed'
    result?: unknown
    reason?: unknown
  }
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/invoker/v1/invocations/:invocationId',
  config: {
    tokenIssuer: [API_ISSUER, INVOKER_ISSUER],
  },
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object()
      .prop('status', S.string().enum(['running', 'completed', 'failed']))
      .required()
      .prop('result')
      .prop('reason'),
  },
  async handler(request, reply) {
    const { events, store } = this
    const { body, params, token } = request

    const oldInvocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!oldInvocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
    }

    if (token.issuer !== INVOKER_ISSUER && body.status !== 'failed') {
      // Other issuers (API service) can only stop the Invocation
      return reply
        .code(403)
        .error({ message: 'User can only directly fail an Invocation.' })
    }

    const result = updateInvocation(oldInvocation, body)
    if (result.isErr) {
      return reply.code(422).error(result.unwrapErr())
    }

    const newInvocation = await store.invocations
      .from(oldInvocation)
      .update(() => result.unwrap())
      .unwrap()

    events.emit('brer.io/invocations/updated', newInvocation._id)

    return { invocation: newInvocation }
  },
})

function updateInvocation(
  invocation: Invocation,
  body: RouteGeneric['Body'],
): IResult<Invocation, ErrorOptions> {
  if (body.status === 'completed') {
    if (invocation.status !== 'running') {
      return Result.err({
        message: 'Invocation must be running to complete it.',
        statusCode: 422,
      })
    }
    return Result.ok(completeInvocation(invocation, body.result))
  } else if (body.status === 'failed') {
    if (invocation.status === 'completed') {
      return Result.err({
        message: 'Unable to fail a completed Invocation.',
        statusCode: 422,
      })
    }
    return Result.ok(failInvocation(invocation, body.reason))
  } else if (body.status === 'running' && invocation.status === 'running') {
    if (!isOlderThan(invocation.updatedAt, 2)) {
      return Result.err({
        message: 'Cannot progress an Invocation too quickly.',
        statusCode: 429,
      })
    }
    return Result.ok(progressInvocation(invocation, body.result))
  } else {
    if (invocation.status !== 'initializing') {
      return Result.err({
        message: 'Invocation must be initializing to run it.',
        statusCode: 422,
      })
    }
    return Result.ok(runInvocation(invocation))
  }
}
