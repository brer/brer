import { ConfirmChannel, connect, Options as AmqplibOptions } from 'amqplib'
import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'

declare module 'fastify' {
  interface FastifyInstance {
    amqp: {
      channel: ConfirmChannel
    }
  }
}

export interface PluginOptions {
  /**
   * Connection string or URL options.
   *
   * @default "amqp://127.0.0.1:5672"
   */
  url?: string | AmqplibOptions.Connect
  /**
   * Raw `node:net` (or `node:tls`) socket options.
   */
  socket?: Record<string, any>
}

async function amqpPlugin(fastify: FastifyInstance, options: PluginOptions) {
  const connection = await connect(
    options.url || 'amqp://127.0.0.1:5672',
    options.socket || {},
  )

  let channel: ConfirmChannel | null = null
  fastify.addHook('onClose', async () => {
    if (channel) {
      fastify.log.trace('nack amqp messages')
      channel.nackAll(true)
    }

    fastify.log.trace('close amqp connection')
    await connection.close()
  })

  channel = await connection.createConfirmChannel()

  const decorator: FastifyInstance['amqp'] = {
    channel,
  }

  fastify.decorate('amqp', decorator)
}

export default plugin(amqpPlugin, {
  name: 'amqp',
})
