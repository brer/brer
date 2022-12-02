import closeWithGrace from 'close-with-grace'

import Fastify from './server.js'

const fastify = Fastify()

const closeListeners = closeWithGrace(
  { delay: 60000 },
  async ({ err, manual, signal }: Record<string, any>) => {
    if (err !== undefined) {
      fastify.log.error({ err }, 'closing because of error')
    }
    if (manual !== undefined) {
      fastify.log.info('application closed manually')
    }
    if (signal !== undefined) {
      fastify.log.info({ signal }, 'received signal')
    }
    await fastify.close()
  },
)

fastify.addHook('onClose', (_, done) => {
  closeListeners.uninstall()
  done()
})

fastify
  .listen({
    host: process.env.SERVER_HOST,
    port: parseInt(process.env.SERVER_PORT || '3000'),
  })
  .catch(err => {
    fastify.log.fatal({ err }, 'bootstrap failed')
    closeListeners.close()
  })
