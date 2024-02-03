import type { FastifyInstance, RouteOptions } from '@brer/fastify'
import type { FnRuntime } from '@brer/function'
import type { Invocation } from '@brer/invocation'
import S from 'fluent-json-schema-es'
import Result, { type IResult } from 'ultres'

import { type ErrorOptions } from '../../lib/error.js'
import { getFunctionByName } from '../../lib/function.js'
import {
  completeInvocation,
  failInvocation,
  progressInvocation,
  runInvocation,
} from '../../lib/invocation.js'
import { API_ISSUER, INVOKER_ISSUER } from '../../lib/token.js'
import { isOlderThan, tail } from '../../lib/util.js'
import { setFunctionRuntime } from '../lib.js'

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
    const { helmsman, store } = this
    const { body, params, token } = request

    const oldInvocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!oldInvocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
    } else if (token.issuer === API_ISSUER && body.status !== 'failed') {
      return reply
        .code(403)
        .error({ message: 'User can only directly fail an Invocation.' })
    } else if (
      token.issuer === INVOKER_ISSUER &&
      oldInvocation.tokenId !== token.id
    ) {
      return reply
        .code(403)
        .error({ message: 'This Invocation is handled by another Pod.' })
    } else if (
      oldInvocation.status === body.status &&
      oldInvocation.status !== 'running'
    ) {
      return { invocation: oldInvocation }
    }

    const result = updateInvocation(oldInvocation, body)
    if (result.isErr) {
      return reply.code(409).error(result.unwrapErr())
    }

    if (
      oldInvocation.runtimeTest &&
      (body.status === 'completed' || body.status === 'failed')
    ) {
      await setFunctionRuntime(
        this,
        token,
        oldInvocation.functionName,
        oldInvocation.image,
        getRuntime(oldInvocation._id, body),
      )
    }

    const newInvocation = await store.invocations
      .from(oldInvocation)
      .assign(result.unwrap())
      .unwrap()

    if (
      newInvocation.status === 'completed' ||
      newInvocation.status === 'failed'
    ) {
      await Promise.all([
        rotateInvocations(this, newInvocation.functionName),
        token.issuer !== INVOKER_ISSUER
          ? helmsman.deleteInvocationPods(params.invocationId)
          : null,
      ])
    }

    return { invocation: newInvocation }
  },
})

function getRuntime(
  invocationId: string,
  body: RouteGeneric['Body'],
): FnRuntime {
  const runtime: any = Object(Object(body.result).runtime)
  if (body.status === 'completed' && typeof runtime.type === 'string') {
    return runtime
  } else {
    return {
      type: 'Unknown',
      invocationId,
    }
  }
}

function updateInvocation(
  invocation: Invocation,
  body: RouteGeneric['Body'],
): IResult<Invocation, ErrorOptions> {
  if (body.status === 'completed') {
    if (invocation.status !== 'running') {
      return Result.err({
        message: 'Invocation must be running to complete it.',
        status: 422,
      })
    }
    return Result.ok(completeInvocation(invocation, body.result))
  } else if (body.status === 'failed') {
    if (invocation.status === 'completed') {
      return Result.err({
        message: 'Unable to fail a completed Invocation.',
        status: 422,
      })
    }
    return Result.ok(failInvocation(invocation, body.reason))
  } else if (body.status === 'running' && invocation.status === 'running') {
    if (!isOlderThan(tail(invocation.phases)?.date, 2)) {
      return Result.err({
        message: 'Cannot progress an Invocation too quickly.',
        status: 429,
      })
    }
    return Result.ok(progressInvocation(invocation, body.result))
  } else {
    if (invocation.status !== 'initializing') {
      return Result.err({
        message: 'Invocation must be initializing to run it.',
        status: 422,
      })
    }
    return Result.ok(runInvocation(invocation))
  }
}

async function rotateInvocations(
  { log, store }: FastifyInstance,
  functionName: string,
) {
  const fn = await getFunctionByName(store, functionName)

  await store.invocations
    .filter({
      _design: 'default',
      _view: 'history',
      startkey: [functionName, {}],
      endkey: [functionName, null],
    })
    .tap(i => log.debug({ invocationId: i._id }, 'purge invocation'))
    .delete()
    .unwrap({
      descending: true,
      purge: true,
      skip: fn ? fn.historyLimit || 10 : 0,
    })
}
