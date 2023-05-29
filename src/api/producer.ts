import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'
import { hostname } from 'node:os'

declare module 'fastify' {
  interface FastifyInstance {
    producer: {
      push(invocationId: string): Promise<void>
    }
  }
}

async function producerPlugin(fastify: FastifyInstance) {
  const { amqp, log } = fastify

  const queue = 'invocations_q'

  log.debug(`assert ${queue} queue`)
  await amqp.channel.assertQueue(queue, {
    arguments: {
      'x-queue-type': 'quorum',
    },
    durable: true,
  })

  const decorator: FastifyInstance['producer'] = {
    push: invocationId =>
      new Promise((resolve, reject) =>
        amqp.channel.sendToQueue(
          queue,
          Buffer.from(JSON.stringify({ invocationId })),
          {
            appId: hostname(),
            contentType: 'application/json',
            mandatory: true,
            persistent: true,
            timestamp: Date.now(),
          },
          err => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          },
        ),
      ),
  }

  fastify.decorate('producer', decorator)
}

export default plugin(producerPlugin, {
  name: 'producer',
  decorators: {
    fastify: ['amqp'],
  },
})
