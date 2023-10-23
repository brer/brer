import type { CouchStore } from '@brer/types'

import Fastify from './server.js'
import { getFunctionId } from './lib/function.js'

const fastify = Fastify()

await fastify.ready()

const { database, log } = fastify

log.info('initialize database')
await Promise.all([
  ensureDatabase(database.functions),
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
  database.invocations.adapter.createIndex({
    index: {
      fields: ['createdAt'],
    },
  }),
  database.invocations.adapter.createIndex({
    index: {
      fields: [
        { functionName: 'desc' },
        { createdAt: 'desc' },
        { status: 'desc' },
      ],
    },
  }),
])

log.info('sync functions name')
const count = await database.functions
  .filter({})
  .update(async doc => {
    const id = getFunctionId(doc.name)
    if (doc._id === id) {
      return doc
    }

    log.debug({ oldId: doc._id, newId: id }, 'upgrade function')
    await database.transaction(() =>
      database.functions
        .read(id)
        .ensure({ ...doc, _id: id, _rev: undefined })
        .unwrap(),
    )

    return { ...doc, _deleted: true }
  })
  .consume()

log.info({ count }, 'all done')

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
