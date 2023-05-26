import type { Fn, Invocation } from '@brer/types'
import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'
import { Entity, Store } from 'mutent'

import { CouchAdapter, CouchDocument, CouchStore } from './adapter.js'

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

  fastify.log.debug('prepare databases')
  await Promise.all([
    ensureDatabase(decorator.functions.adapter),
    ensureDatabase(decorator.invocations.adapter),
  ])
}

async function ensureDatabase(adapter: CouchAdapter<any>) {
  const response = await adapter.got({
    method: 'PUT',
    throwHttpErrors: false,
  })
  if (
    response.statusCode !== 201 &&
    response.statusCode !== 202 &&
    response.statusCode !== 412
  ) {
    // TODO
    throw new Error()
  }
}

export default plugin(databasePlugin, {
  name: 'database',
})
