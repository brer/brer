import type { FastifyInstance, FastifyLogger } from '@brer/types'
import plugin from 'fastify-plugin'

declare module 'fastify' {
  interface FastifyInstance {
    tasks: {
      /**
       * The returned `Promise` will never reject.
       */
      push<T>(
        fn: (log: FastifyLogger) => Promise<T>,
      ): Promise<PromiseSettledResult<T>>
    }
  }
}

async function tasksPlugin(fastify: FastifyInstance) {
  const map = new Map<string, Promise<PromiseSettledResult<any>>>()
  let counter = 0

  fastify.addHook('onClose', async () => {
    if (map.size) {
      fastify.log.info(`waiting for ${map.size} tasks to complete`)
      await Promise.all(map.values())
    }
  })

  const push = <T>(fn: (log: FastifyLogger) => Promise<T>) => {
    const taskId = `task-${(++counter).toString(36)}`
    const log = fastify.log.child({ taskId })

    log.info('run backgroud task')
    const promise: Promise<PromiseSettledResult<T>> = fn(log).then(
      value => {
        log.info('backgroup task completed')
        map.delete(taskId)
        return {
          status: 'fulfilled',
          value,
        }
      },
      reason => {
        log.error({ err: reason }, 'backgroup task failed')
        map.delete(taskId)
        return {
          status: 'rejected',
          reason,
        }
      },
    )

    map.set(taskId, promise)

    return promise
  }

  fastify.decorate('tasks', { push })
}

export default plugin(tasksPlugin, {
  name: 'tasks',
})
