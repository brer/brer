import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'
import { EventEmitter } from 'node:events'

import controller from './controller.js'
import router from './router.js'
import spawn from './spawn.js'

export interface PluginOptions {
  invokerUrl: URL
}

async function invokerPlugin(
  fastify: FastifyInstance,
  { invokerUrl }: PluginOptions,
) {
  const events = new EventEmitter()

  fastify.register(controller)
  fastify.register(spawn, { events, invokerUrl })
  fastify.register(router, { events })
}

export default plugin(invokerPlugin, {
  name: 'invoker',
  decorators: {
    fastify: ['helmsman', 'store'],
  },
  encapsulate: true,
})
