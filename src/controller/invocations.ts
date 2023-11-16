import type { FastifyInstance } from '@brer/fastify'

import { syncInvocationState } from './util.js'

export default async function invocationsWatcher(fastify: FastifyInstance) {
  const { log, store } = fastify

  let promise: Promise<any> | null = null
  let timer: any = null

  const callback = () => {
    if (promise) {
      // this could be an query optimization problem (or a database size problem)
      log.warn('invocations watcher is busy')
      return
    }

    log.trace('run invocations watcher')
    promise = store.invocations
      .filter({
        _design: 'default',
        _view: 'alive',
      })
      .tap(invocation => syncInvocationState(fastify, invocation))
      .consume()
      .catch(err => {
        log.error({ err }, 'invocations watcher error')
      })
      .then(() => {
        promise = null
      })
  }

  fastify.addHook('onReady', async () => {
    timer = setInterval(callback, 60000)
    callback()
  })

  fastify.addHook('onClose', async () => {
    if (timer) {
      clearInterval(timer)
    }
    if (promise) {
      await promise
    }
  })
}
