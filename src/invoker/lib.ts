import type { FastifyInstance } from '@brer/fastify'
import type { FnRuntime } from '@brer/function'
import type { Invocation } from '@brer/invocation'

import {
  failInvocation,
  handleInvocation,
  setTokenId,
} from '../lib/invocation.js'
import { Token, signInvocationToken } from '../lib/token.js'
import { getPodTemplate } from './kubernetes.js'

/**
 * Instantly spawns a `"pending"` Invocation.
 */
export async function handleInvokeEvent(
  fastify: FastifyInstance,
  invocation: Invocation,
  invokerUrl: URL,
): Promise<Invocation> {
  const { helmsman, log, store } = fastify

  const token = await signInvocationToken(invocation._id)

  log.debug({ invocationId: invocation._id }, 'handle invocation')
  invocation = await store.invocations
    .from(invocation)
    .update(doc =>
      doc.status === 'initializing' ? doc : handleInvocation(doc),
    )
    .update(doc => setTokenId(doc, token.id))
    .unwrap()

  log.debug({ invocationId: invocation._id }, 'spawn invocation pod')
  await helmsman.createPod(getPodTemplate(invocation, invokerUrl, token.raw))

  return invocation
}

export async function failWithReason(
  fastify: FastifyInstance,
  invocation: Invocation,
  reason: unknown,
  token?: Token,
) {
  const { log, store } = fastify

  log.debug({ invocationId: invocation._id, reason }, 'invocation has failed')
  return store.invocations
    .from(invocation)
    .update(doc => failInvocation(doc, reason))
    .commit()
    .tap(doc => handleTestInvocation(fastify, doc, token))
    .unwrap()
}

export async function handleTestInvocation(
  { log, pools }: FastifyInstance,
  invocation: Invocation,
  token?: Token,
) {
  if (!invocation.runtimeTest) {
    return
  }
  if (!token) {
    token = await signInvocationToken(invocation._id)
  }

  const response = await pools.get('api').request({
    method: 'PATCH',
    path: `/api/v1/functions/${invocation.functionName}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      runtime: getRuntime(invocation),
    }),
  })

  const data: any = await response.body.json()
  if (response.statusCode === 200) {
    log.debug(
      { functionName: invocation.functionName },
      'image runtime updated',
    )
  } else if (response.statusCode === 404) {
    log.warn({ functionName: invocation.functionName }, 'function not found')
  } else {
    log.error({ response: data }, 'image runtime update failed')
  }
}

function getRuntime(invocation: Invocation): FnRuntime {
  if (
    invocation.status === 'completed' &&
    typeof invocation.result?.runtime === 'string'
  ) {
    return invocation.result.runtime
  } else {
    return {
      type: 'Unknown',
      invocationId: invocation._id,
    }
  }
}
