import type { FastifyInstance, Fn, Invocation } from '@brer/types'
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
        mutentMigration<CouchGenerics<any>>({
          key: 'v',
          version,
        }),
      ],
    })
  }

  const decorator: FastifyInstance['database'] = {
    functions: getStore('functions'),
    invocations: getStore('invocations'),
    transaction,
  }

  // Test database connection
  const response = await decorator.functions.adapter.got<{ doc_count: number }>(
    {
      method: 'GET',
      resolveBodyOnly: true,
    },
  )
  fastify.log.debug(`this database has ${response.doc_count} functions`)
  // TODO: add warning for del_doc_count for all databases

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
