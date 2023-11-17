import type { FastifyInstance } from '@brer/fastify'
import type { Fn } from '@brer/function'
import type { Invocation } from '@brer/invocation'
import type { Project } from '@brer/project'
import HttpAgent, { HttpsAgent } from 'agentkeepalive'
import plugin from 'fastify-plugin'
import { Entity, Store, StoreOptions } from 'mutent'
import { MigrationStrategy, mutentMigration } from 'mutent-migration'
import nano from 'nano'

import {
  CouchAdapter,
  CouchDocument,
  CouchGenerics,
  CouchStore,
} from './adapter.js'
import { parseImagePath } from './image.js'

declare module 'fastify' {
  interface FastifyInstance {
    store: {
      nano: nano.ServerScope
      functions: CouchStore<Fn>
      invocations: CouchStore<Invocation>
      projects: CouchStore<Project>
    }
  }
}

export interface PluginOptions {
  url?: string
  username?: string
  password?: string
}

async function storePlugin(fastify: FastifyInstance, options: PluginOptions) {
  const couchUrl = options.url || 'http://127.0.0.1:5984/'
  const agent = /^https/.test(couchUrl) ? new HttpsAgent() : new HttpAgent() // TODO: agent options?

  const scope = nano({
    url: couchUrl,
    requestDefaults: {
      agent,
      auth: {
        password: options.username || '',
        username: options.password || '',
      },
      timeout: 30000, // CouchDB should be fast :)
    },
  })

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

  const getStore = (
    database: string,
    version: number = 0,
    strategies: Record<number, MigrationStrategy<CouchGenerics<any>>> = {},
  ) => {
    return new Store({
      adapter: new CouchAdapter({
        database,
        server: scope,
      }),
      hooks,
      plugins: [
        mutentMigration<CouchGenerics<any>>({
          key: 'v',
          version,
          strategies,
        }),
      ],
    })
  }

  const decorator: FastifyInstance['store'] = {
    nano: scope,
    functions: getStore('functions', 1, {
      1: obj => ({
        ...obj,
        v: 1,
        project: 'default',
        image: parseImagePath(obj.image),
      }),
    }),
    invocations: getStore('invocations', 1, {
      1: obj => ({
        ...obj,
        v: 1,
        project: 'default',
        image: parseImagePath(obj.image),
      }),
    }),
    projects: getStore('projects'),
  }

  fastify.decorate('store', decorator)
}

export default plugin(storePlugin, {
  name: 'store',
})
