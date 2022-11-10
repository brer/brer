import { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import { Entity, Store } from 'mutent'

import { CouchAdapter, CouchDocument, CouchStore } from './store.js'

import { Fn } from '../api/functions/lib/types.js'
import { Invocation } from '../api/invocations/lib/types.js'

declare module 'fastify' {
  interface FastifyInstance {
    database: {
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
  const hooks = {
    beforeCreate(entity: Entity<CouchDocument>) {
      const now = entity.valueOf().createdAt || new Date().toISOString()
      entity.valueOf().createdAt = now
      entity.valueOf().updatedAt = now
    },
    beforeUpdate(entity: Entity<CouchDocument>) {
      entity.valueOf().updatedAt = new Date().toISOString()
    },
  }

  const decorator: FastifyInstance['database'] = {
    invocations: new Store({
      adapter: new CouchAdapter<Invocation>({
        ...options,
        database: 'invocations',
      }),
      hooks,
    }),
    functions: new Store({
      adapter: new CouchAdapter<Fn>({
        ...options,
        database: 'functions',
      }),
      hooks,
    }),
  }

  fastify.decorate('database', decorator)

  // TODO: ensure databases
  // await Promise.all([
  //   fastify.database.invocations.mustExists(),
  //   fastify.database.functions.mustExists(),
  // ])
}

export default plugin(databasePlugin, {
  name: 'database',
})
