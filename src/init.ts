import type { CouchDocument, CouchStore } from '@brer/couchdb'
import type { ViewDocument } from 'nano'

import Fastify from './server.js'

const fastify = Fastify()

await fastify.ready()

async function init() {
  const { log, store } = fastify

  log.info('initialize database')
  await Promise.all([
    store.nano.db.create(store.functions.adapter.database).catch(existsOk),
    store.nano.db.create(store.invocations.adapter.database).catch(existsOk),
  ])

  const invocationsHistoryMap = `
    function (doc) {
      if (doc.status === 'completed' || doc.status === 'failed') {
        emit([doc.functionName, doc.createdAt], null)
      }
    }
  `

  const byGroupMap = `
    function (doc) {
      emit([doc.group, doc.functionName || doc.name, doc.createdAt], null)
    }
  `

  const functionsRegistryMap = `
    function (doc) {
      if (doc.exposeRegistry === true && typeof doc.image === 'object') {
        emit([doc.image.host, doc.image.name], [doc.group])
      }
    }
  `

  // TODO: check rereduce
  const functionsRegistryReduce = `
    function (keys, values, rereduce) {
      return values.reduce((a, b) => a.concat(b))
    }
  `

  const invocationsControllerMap = `
    function (doc) {
      if (doc.status === 'pending' || doc.status === 'initializing' || doc.status === 'running') {
        emit([doc.group, doc.functionName, doc.createdAt], null)
      }
    }
  `

  log.info('write design documents')
  await Promise.all([
    design(store.functions, {
      _id: '_design/default',
      views: {
        by_group: {
          map: byGroupMap,
        },
        registry: {
          map: functionsRegistryMap,
          reduce: functionsRegistryReduce,
        },
      },
    }),
    design(store.invocations, {
      _id: '_design/default',
      views: {
        by_group: {
          map: byGroupMap,
        },
        history: {
          map: invocationsHistoryMap,
        },
        controller: {
          map: invocationsControllerMap,
        },
      },
    }),
  ])
}

function existsOk(err: unknown) {
  if (Object(err).statusCode !== 412) {
    return Promise.reject(err)
  }
}

async function design<T extends CouchDocument>(
  store: CouchStore<T>,
  doc: ViewDocument<T> & { _rev?: string },
) {
  const nano = store.adapter.nano

  try {
    const result = await nano.get(doc._id)
    doc._rev = result._rev
  } catch (err) {
    if (Object(err).statusCode !== 404) {
      return Promise.reject(err)
    }
  }

  await nano.insert(doc)
}

try {
  await init()
} catch (err) {
  fastify.log.fatal({ err }, 'init job has failed')
  process.exitCode = 1
}

await fastify.close()
