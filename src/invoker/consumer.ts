import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import { Message, Reader } from 'nsqjs'

import { handleInvocation } from '../api/invocations/lib/invocation.js'
import { getPodTemplate } from '../api/invocations/lib/kubernetes.js'
import { encodeToken } from '../lib/token.js'

async function consumerPlugin(fastify: FastifyInstance) {
  const { database, kubernetes, log } = fastify

  const host = process.env.NSQLOOKUPD_HOST || '127.0.0.1'
  const port = parseInt(process.env.NSQLOOKUPD_PORT || '4161')
  const topic = process.env.NSQ_TOPIC || 'invocation'
  const channel = process.env.NSQ_CHANNEL || 'brer'

  const reader = new Reader(topic, channel, {
    lookupdHTTPAddresses: `${host}:${port}`,
    maxInFlight: 10,
  })

  // TODO: connection logs?
  // reader.on('nsqd_connected', cleanAndReconnect)
  // reader.on('nsqd_closed', cleanAndReconnect)

  reader.on('message', message => {
    log.info({ msgId: message.id }, 'nsq message received')
    messageHandler(message).then(
      () => {
        log.debug({ msgId: message.id }, 'nsq message consumed')
        message.finish()
      },
      err => {
        log.error({ msgId: message.id, err }, 'requeue nsq message')
        message.requeue()
      },
    )
  })

  async function messageHandler(message: Message) {
    const invocation = await database.invocations
      .from(JSON.parse(message.body.toString()))
      .update(handleInvocation)
      .unwrap()

    const token = encodeToken(invocation._id!)

    const url =
      process.env.BRER_URL ||
      `http://brer-invoker.${kubernetes.namespace}.svc.cluster.local/`

    await kubernetes.api.CoreV1Api.createNamespacedPod(
      kubernetes.namespace,
      getPodTemplate(invocation, url, token),
    )
  }

  fastify.addHook('onReady', async () => {
    reader.connect()
  })

  fastify.addHook('onClose', async () => {
    reader.close()
  })
}

export default plugin(consumerPlugin, {
  name: 'consumer',
  decorators: {
    fastify: ['database', 'kubernetes'],
  },
})
