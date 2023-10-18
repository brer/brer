import type { FastifyInstance, Invocation } from '@brer/types'
import plugin from 'fastify-plugin'

import invocationsWatcher from './invocations.js'
import kubernetesWatcher from './kubernetes.js'
import rpcApi from './rpc.js'
import { handleInvokeEvent } from './util.js'

async function controllerPlugin(fastify: FastifyInstance) {
  const { log } = fastify

  fastify.events.on(
    'brer.invocations.invoke',
    ({ invocation }: { invocation: Invocation }) =>
      handleInvokeEvent(fastify, invocation).catch(err =>
        log.error({ invocationId: invocation._id, err }, 'invoke failure'),
      ),
  )

  fastify.register(invocationsWatcher)
  fastify.register(kubernetesWatcher)
  fastify.register(rpcApi)
}

export default plugin(controllerPlugin, {
  name: 'controller',
  decorators: {
    fastify: ['database', 'events', 'kubernetes'],
  },
  encapsulate: true,
})
