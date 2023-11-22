import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import { type EventEmitter } from 'node:events'

import { hasTimedOut } from '../lib/invocation.js'
import { getPodStatus } from '../lib/kubernetes.js'
import { failWithReason, handleInvokeEvent } from './lib.js'

export interface PluginOptions {
  events: EventEmitter
  invokerUrl: URL
}

export default async function spawnPlugin(
  fastify: FastifyInstance,
  { events, invokerUrl }: PluginOptions,
) {
  const { log, store } = fastify

  let promise: Promise<any> | null = null
  let timer: any = null

  const callback = () => {
    if (promise) {
      // this could be an query optimization problem (or a database size problem)
      log.warn('invocations watcher is busy')
      return
    }

    log.trace('run invocations watcher')
    promise = store.invocations
      .filter({
        _design: 'default',
        _view: 'alive',
      })
      .tap(invocation => syncInvocationState(fastify, invocation, invokerUrl))
      .consume()
      .catch(err => {
        log.error({ err }, 'invocations watcher error')
      })
      .then(() => {
        promise = null
      })
  }

  events.on('brer.io/invoker/invocations/created', callback)

  fastify.addHook('onReady', async () => {
    timer = setInterval(callback, 60000)
    callback()
  })

  fastify.addHook('onClose', async () => {
    if (timer) {
      clearInterval(timer)
    }
    if (promise) {
      await promise
    }
  })
}

/**
 * Invocation watchdog handler.
 */
async function syncInvocationState(
  fastify: FastifyInstance,
  invocation: Invocation,
  invokerUrl: URL,
): Promise<Invocation> {
  const { helmsman } = fastify

  if (invocation.status === 'pending') {
    // Invoke event was lost
    invocation = await handleInvokeEvent(fastify, invocation, invokerUrl)
  } else if (invocation.status === 'initializing') {
    if (hasTimedOut(invocation)) {
      // Stuck inside Kubernetes somehow (ex. missing secret)
      invocation = await failWithReason(fastify, invocation, 'timed out')
    } else {
      const pod = await helmsman.getPodByInvocationId(invocation._id)
      const podStatus = pod ? getPodStatus(pod) : 'Failed'
      if (!pod) {
        // Previous Pod spawn failed
        invocation = await handleInvokeEvent(fastify, invocation, invokerUrl)
      } else if (podStatus === 'Failed' || podStatus === 'Succeeded') {
        // Pod has completed without notification
        invocation = await failWithReason(
          fastify,
          invocation,
          podStatus === 'Succeeded' ? 'early termination' : 'runtime failure',
        )
      }
    }
  } else if (invocation.status === 'running') {
    const pod = await helmsman.getPodByInvocationId(invocation._id)
    const podStatus = pod ? getPodStatus(pod) : 'Failed'

    if (podStatus === 'Failed' || podStatus === 'Succeeded') {
      invocation = await failWithReason(
        fastify,
        invocation,
        !pod
          ? 'pod deletion'
          : podStatus === 'Succeeded'
            ? 'early termination'
            : 'runtime failure',
      )
    }
  }

  return invocation
}
