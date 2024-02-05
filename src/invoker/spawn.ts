import type { FastifyInstance } from '@brer/fastify'
import Queue from 'fastq'
import plugin from 'fastify-plugin'

import { hasTimedOut } from '../lib/invocation.js'
import { getPodStatus } from './kubernetes.js'
import { failWithReason, handleInvokeEvent } from './lib.js'

export interface PluginOptions {
  invokerUrl: URL
}

async function spawnPlugin(
  fastify: FastifyInstance,
  { invokerUrl }: PluginOptions,
) {
  const { events, helmsman, log, store } = fastify

  let closed = false

  const handler = async (invocationId: string) => {
    if (closed) {
      return
    }

    const invocation = await store.invocations.find(invocationId).unwrap()
    if (!invocation) {
      return
    }

    if (invocation.status === 'pending') {
      // Init the Invocation
      await handleInvokeEvent(fastify, invocation, invokerUrl)
    } else if (invocation.status === 'initializing') {
      if (hasTimedOut(invocation)) {
        // Stuck inside Kubernetes somehow (ex. missing secret)
        await failWithReason(fastify, invocation, 'timed out')
      } else {
        const pod = await helmsman.getPodByInvocationId(invocation._id)
        const podStatus = pod ? getPodStatus(pod) : 'Failed'
        if (!pod) {
          // Previous Pod spawn failed
          await handleInvokeEvent(fastify, invocation, invokerUrl)
        } else if (podStatus === 'Failed' || podStatus === 'Succeeded') {
          // Pod has completed without notification
          await failWithReason(
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
        await failWithReason(
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
  }

  const queue = Queue.promise(
    invocationId =>
      handler(invocationId).catch(err => {
        log.error({ invocationId, err }, 'spawn error')
        if (!closed) {
          // retry after 10s
          setTimeout(() => queue.push(invocationId), 10000)
        }
      }),
    1,
  )

  events.on('brer.io/invoker/invocations/created', data => {
    if (!closed) {
      queue.push(data.invocation._id)
    }
  })

  // Init currently pending Invocations at startup
  fastify.addHook('onReady', async () => {
    await store.invocations
      .filter({
        _design: 'default',
        _view: 'alive',
      })
      .tap(doc => {
        // do not wait the Promise
        queue.push(doc._id)
      })
      .consume()
  })

  fastify.addHook('onClose', async () => {
    closed = true
    await queue.kill()
    await queue.drained()
  })
}

export default plugin(spawnPlugin, {
  name: 'spawn',
  decorators: {
    fastify: ['events', 'helmsman', 'store'],
  },
  encapsulate: true,
})
