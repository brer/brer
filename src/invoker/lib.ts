import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'

import { getFunctionByName, setFunctionRuntime } from '../lib/function.js'
import { isSameImage } from '../lib/image.js'
import {
  failInvocation,
  handleInvocation,
  isTestRun,
  setTokenId,
} from '../lib/invocation.js'
import { getPodTemplate } from '../lib/kubernetes.js'
import { signInvocationToken } from '../lib/token.js'

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
    .update(doc => (doc.status === 'pending' ? handleInvocation(doc) : doc))
    .tap(doc => {
      if (doc.status !== 'initializing') {
        return Promise.reject(
          new Error('Expected Invocation to be initializing'),
        )
      }
    })
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
) {
  const { log, store } = fastify

  log.debug({ invocationId: invocation._id, reason }, 'invocation has failed')
  invocation = await store.invocations
    .from(invocation)
    .update(doc => failInvocation(doc, reason))
    .tap(doc => handleTestInvocation(store, doc))
    .unwrap()

  await rotateInvocations(fastify, invocation.functionName)

  return invocation
}

export async function handleTestInvocation(
  store: FastifyInstance['store'],
  invocation: Invocation,
) {
  if (
    isTestRun(invocation) &&
    (invocation.status === 'completed' || invocation.status === 'failed')
  ) {
    // TODO
    await store.functions
      .from(asIterable(store, invocation))
      .filter(fn => isSameImage(invocation.image, fn.image))
      .update(fn => setFunctionRuntime(fn, invocation))
      .unwrap()
  }
}

async function* asIterable(
  store: FastifyInstance['store'],
  invocation: Invocation,
) {
  const fn = await getFunctionByName(store, invocation.functionName)
  if (fn) {
    yield fn
  }
}

export async function rotateInvocations(
  { log, store }: FastifyInstance,
  fnName: string,
) {
  const fn = await getFunctionByName(store, fnName)
  if (fn) {
    log.debug({ functionName: fnName }, 'rotate invocations')
    return store.invocations
      .filter({
        _design: 'default',
        _view: 'dead',
        startkey: [fnName, {}],
        endkey: [fnName, null],
      })
      .delete()
      .consume({
        descending: true,
        purge: true,
        skip: fn.historyLimit || 10,
      })
  }
}
