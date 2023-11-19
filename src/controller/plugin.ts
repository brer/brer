import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'

import invocationsWatcher from './invocations.js'
import kubernetesWatcher from './kubernetes.js'
import rpcApi from './rpc.js'

async function controllerPlugin(fastify: FastifyInstance) {
  fastify.register(invocationsWatcher)
  fastify.register(kubernetesWatcher)
  fastify.register(rpcApi)
}

export default plugin(controllerPlugin, {
  name: 'controller',
  decorators: {
    fastify: ['helmsman', 'store'],
  },
  encapsulate: true,
})
