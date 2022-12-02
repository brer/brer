import type { Invocation } from '@brer/types'
import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import Queue from 'fastq'

import { handleInvocation } from '../api/invocations/lib/invocation.js'
import { getPodTemplate } from '../api/invocations/lib/kubernetes.js'
import { encodeToken } from './token.js'

declare module 'fastify' {
  interface FastifyInstance {
    pendingInvocations: Queue.queueAsPromised<Invocation>
  }
}

/**
 * TODO: this plugin should use some message protocol like AMQP or something else
 */
async function queuePlugin(fastify: FastifyInstance) {
  const { database, kubernetes, log } = fastify

  const queue = Queue.promise(worker, 1)
  const retries = new WeakMap<Invocation, number>()
  const maxRetries = 3 // TODO: plugin options?

  queue.error((err, invocation) => {
    // TODO: for some reasons, this callback is called ALWAYS
    if (err) {
      log.error(
        { invocationId: invocation._id, err },
        'unable to initialize an invocation',
      )
    }
  })

  async function worker(invocation: Invocation) {
    if (invocation.status === 'pending') {
      // Set the invocation to "initializing" only the first time
      invocation = await database.invocations
        .from(invocation)
        .update(handleInvocation)
        .unwrap()
    }

    // First attempt is 1 (not zero)
    const attempt = retries.get(invocation) || 1

    try {
      const result = await kubernetes.api.CoreV1Api.createNamespacedPod(
        kubernetes.namespace,
        getPodTemplate(
          invocation,
          process.env.BRER_URL ||
            `http://brer.${kubernetes.namespace}.svc.cluster.local/`,
          encodeToken(invocation._id!),
        ),
      )

      log.debug({ pod: result.body.metadata?.name }, 'pod created')
    } catch (err) {
      if (attempt < maxRetries) {
        log.debug(
          { invocationId: invocation._id, attempt, err },
          'failed to spawn pod',
        )
        queue.push(invocation)
        retries.set(invocation, attempt + 1)
      } else {
        log.error(
          { invocationId: invocation._id, err },
          `failed to spawn pod after ${maxRetries} attempts`,
        )
      }
    }
  }

  // Stop the queue
  queue.pause()

  // Load the queue with the Invocations that needs to be started
  for await (const invocation of database.invocations
    .filter({ status: 'pending' })
    .iterate()) {
    queue.push(invocation)
  }

  fastify.addHook('onReady', async () => {
    // Start the queue when the server starts
    queue.resume()
  })

  fastify.addHook('onClose', async () => {
    if (!queue.idle()) {
      log.debug('waiting for remained queue events')
      await queue.drained()
    }
  })

  fastify.decorate('pendingInvocations', queue)
}

export default plugin(queuePlugin, {
  name: 'queue',
  decorators: {
    fastify: ['database', 'kubernetes'],
  },
})
