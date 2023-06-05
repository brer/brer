import type { Fn, Invocation, InvocationLog } from '@brer/types'
import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'
import { Entity, MutentError, Store, StoreOptions } from 'mutent'
import { mutentMigration } from 'mutent-migration'

import {
  CouchAdapter,
  CouchDocument,
  CouchGenerics,
  CouchStore,
} from './adapter.js'

declare module 'fastify' {
  interface FastifyInstance {
    database: {
      transaction<T>(fn: (attempt: number) => Promise<T>): Promise<T>
      functions: CouchStore<Fn>
      invocations: CouchStore<Invocation>
      invocationLogs: CouchStore<InvocationLog>
    }
  }
}

export interface PluginOptions {
  url?: string
  username?: string
  password?: string
}

async function databasePlugin(
  fastify: FastifyInstance,
  options: PluginOptions,
) {
  const hooks: StoreOptions<CouchGenerics<any>>['hooks'] = {
    beforeCreate(entity: Entity<CouchDocument>) {
      if (!entity.target.createdAt) {
        entity.target.createdAt =
          entity.target.updatedAt || new Date().toISOString()
      }
      if (!entity.target.updatedAt) {
        entity.target.updatedAt = entity.target.createdAt
      }
    },
    beforeUpdate(entity: Entity<CouchDocument>) {
      if (entity.target.updatedAt === entity.source!.updatedAt) {
        entity.target.updatedAt = new Date().toISOString()
      }
    },
  }

  const getStore = (database: string, version: number = 0) => {
    return new Store({
      adapter: new CouchAdapter({
        ...options,
        database,
      }),
      hooks,
      plugins: [
        mutentMigration({
          key: '_v',
          version,
        }),
      ],
    })
  }

  const decorator: FastifyInstance['database'] = {
    functions: getStore('functions'),
    invocationLogs: getStore('invocation-logs'),
    invocations: getStore('invocations'),
    transaction,
  }

  fastify.decorate('database', decorator)
}

function transaction<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let attempt = 0

    const run = () => {
      fn(attempt++).then(resolve, err => {
        if (
          err instanceof MutentError &&
          err.code === 'COUCHDB_WRITE_ERROR' &&
          err.info.statusCode === 409 &&
          attempt < 3
        ) {
          process.nextTick(run)
        } else {
          reject(err)
        }
      })
    }

    run()
  })
}

export default plugin(databasePlugin, {
  name: 'database',
})
