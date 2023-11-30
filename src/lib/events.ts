import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'
import { EventEmitter } from 'node:events'

declare module 'fastify' {
  interface FastifyInstance {
    events: EventEmitter
  }
}

async function eventsPlugin(fastify: FastifyInstance) {
  const events = new EventEmitter()

  events.on('error', err => {
    fastify.log.fatal({ err }, 'emit an error')
    fastify.close()
  })

  fastify.decorate('events', events)
}

export default plugin(eventsPlugin, {
  name: 'events',
})
