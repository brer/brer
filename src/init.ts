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
    store.nano.db.create(store.projects.adapter.database).catch(existsOk),
    store.nano.db.create(store.users.adapter.database).catch(existsOk),
  ])

  // TODO: create admin user with random password

  const invocationsHistoryMap = `
    function (doc) {
      if (doc.status === 'completed' || doc.status === 'failed') {
        emit([doc.functionName, doc.createdAt], null)
      }
    }
  `

  const mapFunctionsByProject = `
    function (doc) {
      emit([doc.project, doc.name], null)
    }
  `

  const mapInvocationsByProject = `
    function (doc) {
      emit([doc.project, doc.functionName, doc.createdAt], null)
    }
  `

  const mapRegistryFunctions = `
    function (doc) {
      if (typeof doc.image === 'object') {
        emit([doc.image.host, doc.image.name], [doc.project])
      }
    }
  `

  // TODO: check rereduce
  const reduceArrays = `
    function (keys, values, rereduce) {
      return values.reduce((a, b) => a.concat(b))
    }
  `

  const mapControllerInvocations = `
    function (doc) {
      if (doc.status === 'pending' || doc.status === 'initializing' || doc.status === 'running') {
        emit(doc.createdAt, null)
      }
    }
  `

  const mapUsersByUsername = `
    function (doc) {
      emit(doc.username, null)
    }
  `

  const mapProjectsByUsername = `
    function (doc) {
      emit('admin', [doc.name])
      for (var username in Object(doc.roles)) {
        if (username !== 'admin' && doc.roles[username] !== 'publisher') {
          emit(username, [doc.name])
        }
      }
    }
  `

  const mapProjectsByName = `
    function (doc) {
      emit(doc.name, null)
    }
  `

  log.info('write design documents')
  await Promise.all([
    design(store.functions, {
      _id: '_design/default',
      views: {
        by_project: {
          map: mapFunctionsByProject,
        },
        registry: {
          map: mapRegistryFunctions,
          reduce: reduceArrays,
        },
      },
    }),
    design(store.invocations, {
      _id: '_design/default',
      views: {
        by_project: {
          map: mapInvocationsByProject,
        },
        history: {
          map: invocationsHistoryMap,
        },
        controller: {
          map: mapControllerInvocations,
        },
      },
    }),
    design(store.projects, {
      _id: '_design/default',
      views: {
        by_name: {
          map: mapProjectsByName,
        },
        by_username: {
          map: mapProjectsByUsername,
          reduce: reduceArrays,
        },
      },
    }),
    design(store.users, {
      _id: '_design/default',
      views: {
        by_username: {
          map: mapUsersByUsername,
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
