import type { FastifyInstance } from '@brer/fastify'
import type { FnRuntime } from '@brer/function'
import type { Invocation, InvocationImage } from '@brer/invocation'

import {
  failInvocation,
  handleInvocation,
  setTokenId,
} from '../lib/invocation.js'
import { type Token } from '../lib/token.js'
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

  // TODO: move into function option
  const expiresIn = 86400 // 24 hours (seconds)

  const token = await fastify.token.signInvocationToken(
    invocation._id,
    expiresIn,
  )

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
): Promise<Invocation> {
  const { log, store } = fastify

  if (invocation.status === 'failed') {
    log.trace({ inovcationId: invocation._id }, 'invocation already failed')
    return invocation
  }
  if (invocation.status === 'completed') {
    log.warn(
      { inovcationId: invocation._id },
      'cannot fail a completed invocation',
    )
    return invocation
  }

  log.debug({ invocationId: invocation._id, reason }, 'invocation has failed')
  if (invocation.runtimeTest) {
    const token = await fastify.token.signInvocationToken(invocation._id, 60)

    await setFunctionRuntime(
      fastify,
      token,
      invocation.functionName,
      invocation.image,
      {
        type: 'Unknown',
        invocationId: invocation._id,
      },
    )
  }

  return store.invocations
    .from(invocation)
    .update(doc => failInvocation(doc, reason))
    .unwrap()
}

export async function setFunctionRuntime(
  { log, pools }: FastifyInstance,
  token: Token,
  functionName: string,
  image: InvocationImage,
  runtime: FnRuntime,
) {
  const response = await pools.get('api').request({
    method: 'PUT',
    path: `/api/v1/functions/${functionName}/runtime`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      image,
      runtime,
    }),
  })

  const data: any = await response.body.json()
  if (response.statusCode === 200) {
    log.debug({ functionName }, 'image runtime updated')
  } else if (response.statusCode === 404) {
    log.debug({ functionName }, 'function not found')
  } else if (response.statusCode === 409) {
    // Function was updated before the test-invocation finish
    log.debug({ functionName }, 'function image mismatch')
  } else {
    log.error({ functionName, response: data }, 'runtime update failed')
  }
}
