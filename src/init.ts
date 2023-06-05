import type { CouchStore } from '@brer/types'

import Fastify from './server.js'

const fastify = Fastify()

await fastify.ready()

const { database, log } = fastify

log.info('initialize database')
await Promise.all([
  ensureDatabase(database.functions),
  ensureDatabase(database.invocationLogs),
  ensureDatabase(database.invocations),
])

log.info('create indexes')
await Promise.all([
  database.functions.adapter.createIndex({
    index: {
      fields: ['createdAt'],
    },
  }),
  database.functions.adapter.createIndex({
    index: {
      fields: ['name'],
    },
  }),
])

log.info('all done')

async function ensureDatabase(store: CouchStore<any>) {
  const response = await store.adapter.got({
    method: 'PUT',
    throwHttpErrors: false,
  })
  if (
    response.statusCode !== 201 &&
    response.statusCode !== 202 &&
    response.statusCode !== 412
  ) {
    log.error(
      { database: store.adapter.database, err: response.body },
      'failed to initialize the database',
    )
    throw new Error('Database initialization failed')
  }
}
