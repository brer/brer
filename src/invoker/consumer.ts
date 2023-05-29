import type { ConsumeMessage } from 'amqplib'
import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'
import Queue from 'fastq'

import { handleInvocation } from '../api/invocations/lib/invocation.js'
import {
  getLabelSelector,
  getPodTemplate,
} from '../api/invocations/lib/kubernetes.js'
import { encodeToken } from '../lib/token.js'

interface Payload {
  invocationId: string
}

async function consumerPlugin(fastify: FastifyInstance) {
  const { amqp, database, kubernetes, log } = fastify

  const queue = 'invocations_q'
  let closed = false

  log.debug({ queue }, 'check for queue')
  await amqp.channel.checkQueue(queue)

  const worker = async (message: ConsumeMessage) => {
    const { invocationId }: Payload = JSON.parse(message.content.toString())

    const invocation = await database.invocations
      .find(invocationId)
      .update(obj => (obj.status === 'pending' ? handleInvocation(obj) : obj))
      .unwrap()

    if (invocation?.status !== 'initializing') {
      log.debug({ invocationId }, 'ignore invocation')
      return
    }

    const response = await kubernetes.api.CoreV1Api.listNamespacedPod(
      kubernetes.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      getLabelSelector({ invocationId: invocation._id }),
      1,
    )

    if (!response.body.items.length) {
      const token = encodeToken(invocationId)

      const url =
        process.env.PUBLIC_URL ||
        `http://brer-invoker.${kubernetes.namespace}.svc.cluster.local/`

      log.debug({ invocationId }, 'spawn pod')
      await kubernetes.api.CoreV1Api.createNamespacedPod(
        kubernetes.namespace,
        getPodTemplate(invocation, url, token),
      )
    } else {
      log.debug({ invocationId }, 'skip pod creation')
    }
  }

  const jobs = Queue.promise(worker, 16)

  // start queue after fastify
  jobs.pause()

  const { consumerTag } = await amqp.channel.consume(queue, message => {
    if (message && !closed) {
      log.info(
        { queue, deliveryTag: message.fields.deliveryTag },
        'message received',
      )
      jobs.push(message).then(
        () => {
          log.info(
            { queue, deliveryTag: message.fields.deliveryTag },
            'message consumed',
          )
          amqp.channel.ack(message, false)
        },
        err => {
          log.error(
            { queue, deliveryTag: message.fields.deliveryTag, err },
            'error while consuming a message',
          )
          amqp.channel.nack(message, false, true)
        },
      )
    }
  })
  log.debug({ queue, consumerTag }, 'consumer is ready')

  fastify.addHook('onReady', async () => {
    jobs.resume()
  })

  fastify.addHook('onClose', async () => {
    closed = true
    if (!jobs.idle()) {
      log.debug({ queue }, 'wait for processing messages')
      await jobs.drained()
    }
  })
}

export default plugin(consumerPlugin, {
  name: 'consumer',
  decorators: {
    fastify: ['amqp', 'database', 'kubernetes'],
  },
})
