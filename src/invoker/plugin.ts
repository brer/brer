import type { FastifyInstance } from '@brer/fastify'
import kubernetes, { type FastifyKubernetesOptions } from 'fastify-kubernetes'
import plugin from 'fastify-plugin'

import controller from './controller.js'
import events from './events.js'
import router from './router.js'

export interface PluginOptions {
  apiUrl: URL
  invokerUrl: URL
  kubernetes: FastifyKubernetesOptions
}

async function invokerPlugin(fastify: FastifyInstance, options: PluginOptions) {
  fastify.pools.set('api', options.apiUrl)

  fastify.register(events)
  fastify.register(kubernetes, options.kubernetes)
  fastify.register(controller, { invokerUrl: options.invokerUrl })
  fastify.register(router)
}

export default plugin(invokerPlugin, {
  name: 'invoker',
  decorators: {
    fastify: ['pools', 'store', 'token'],
  },
  encapsulate: true,
})
