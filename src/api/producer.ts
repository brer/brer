import type { Invocation } from '@brer/types'
import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import { ConnectionConfigOptions, Writer } from 'nsqjs'

import { failInvocation } from './invocations/lib/invocation.js'

declare module 'fastify' {
  interface FastifyInstance {
    producer: {
      push(invocation: Invocation): void
    }
  }
}

async function producerPlugin(fastify: FastifyInstance) {
  const { database, log } = fastify
  log.debug('producer plugin is enabled')

  const host = process.env.NSQD_HOST || '127.0.0.1'
  const port = parseInt(process.env.NSQD_PORT || '4150')
  const topic = process.env.NSQ_TOPIC || 'invocation'

  let closed = false
  let writer: Writer | undefined

  const queue: Invocation[] = []

  async function connect() {
    log.info('connect nsq writer')

    writer = await createWriter(host, port)
    writer.on('error', errorHandler)
    writer.on('closed', cleanAndReconnect)

    while (queue.length > 0) {
      await publish(queue[0])
      queue.shift()
    }
  }

  function errorHandler(err: any) {
    if (err) {
      fastify.log.error({ err }, 'nsq producer error')
    }
  }

  function clean() {
    if (writer) {
      log.debug('stop nsq producer')
      writer.close()
      writer = undefined
    }
  }

  function cleanAndReconnect() {
    clean()
    if (!closed) {
      process.nextTick(() =>
        connect().catch(err => {
          log.error({ err })
          cleanAndReconnect()
        }),
      )
    }
  }

  function publish(invocation: Invocation): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!writer) {
        reject(new Error('NSQ not ready'))
      } else {
        writer.publish(topic, invocation, err => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      }
    })
  }

  // Initialize (and test) NSQ connection
  await connect()

  fastify.addHook('onClose', async () => {
    closed = true
    clean()
    if (queue.length > 0) {
      log.info("some invocations couldn't be enqueued")
      await database.invocations
        .from(queue)
        .update(doc => failInvocation(doc))
        .unwrap()
        .catch(err =>
          log.fatal({ invocation: queue, err }, 'orphaned invocations'),
        )
    }
  })

  const decorator: FastifyInstance['producer'] = {
    push: invocation => {
      if (queue.length > 0) {
        queue.push(invocation)
      } else {
        publish(invocation).catch(err => {
          log.error({ err }, 'failed to publish')
          queue.push(invocation)
          cleanAndReconnect()
        })
      }
    },
  }

  fastify.decorate('producer', decorator)
}

function createWriter(
  host: string,
  port: number,
  options?: ConnectionConfigOptions,
) {
  return new Promise<Writer>((resolve, reject) => {
    const writer = new Writer(host, port, options)

    writer.on('error', reject)

    const timer = setTimeout(() => {
      reject(new Error('NSQ writer connection timeout'))
    }, 5000)

    writer.once('ready', () => {
      clearTimeout(timer)
      resolve(writer)
    })

    writer.connect()
  })
}

export default plugin(producerPlugin, {
  name: 'producer',
  decorators: {
    fastify: ['database'],
  },
})
