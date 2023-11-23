import type { FastifyInstance } from '@brer/fastify'
import kubernetes, { type FastifyKubernetesOptions } from 'fastify-kubernetes'
import plugin from 'fastify-plugin'

import controller from './controller.js'
import helmsman from './helmsman.js'
import router from './router.js'
import spawn from './spawn.js'

export interface PluginOptions {
  apiUrl: URL
  invokerUrl: URL
  kubernetes: FastifyKubernetesOptions
}

async function invokerPlugin(fastify: FastifyInstance, options: PluginOptions) {
  fastify.pools.set('api', options.apiUrl)

  fastify.register(kubernetes, options.kubernetes)
  fastify.register(helmsman)
  fastify.register(controller)
  fastify.register(spawn, { invokerUrl: options.invokerUrl })
  fastify.register(router)
}

export default plugin(invokerPlugin, {
  name: 'invoker',
  decorators: {
    fastify: ['pools', 'store'],
  },
  encapsulate: true,
})
