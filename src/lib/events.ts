import type { FastifyInstance } from '@brer/types'
import plugin from 'fastify-plugin'
import { EventEmitter } from 'node:events'

declare module 'fastify' {
  interface FastifyInstance {
    events: EventEmitter
  }
}

async function eventsPlugin(fastify: FastifyInstance) {
  // TODO: "error" event?
  fastify.decorate('events', new EventEmitter())
}

export default plugin(eventsPlugin, {
  name: 'events',
})
