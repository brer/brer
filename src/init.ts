import type { CouchDocument, CouchStore } from '@brer/couchdb'
import type { ViewDocument } from 'nano'

import { createProject } from './lib/project.js'
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
  ])

  const reduceArrays = `
    function (keys, values, rereduce) {
      return values.reduce((a, b) => a.concat(b))
    }
  `

  const mapFunctionsByName = `
    function (doc) {
      emit([doc.name, doc.createdAt], null)
    }
  `

  const mapFunctionsByProject = `
    function (doc) {
      if (!doc.draft) {
        emit([doc.project, doc.name], null)
      }
    }
  `

  const mapRegistryFunctions = `
    function (doc) {
      if (!doc.draft && typeof doc.image === 'object') {
        emit([doc.image.host, doc.image.name], [doc.project])
      }
    }
    `

  await design(store.functions, {
    _id: '_design/default',
    views: {
      by_name: {
        map: mapFunctionsByName,
      },
      by_project: {
        map: mapFunctionsByProject,
      },
      registry: {
        map: mapRegistryFunctions,
        reduce: reduceArrays,
      },
    },
  })

  const mapInvocationsByProject = `
    function (doc) {
      emit([doc.project, doc.functionName, doc.createdAt], null)
    }
  `

  const mapAliveInvocations = `
    function (doc) {
      if (doc.status === 'pending' || doc.status === 'initializing' || doc.status === 'running') {
        emit(doc.createdAt, null)
      }
    }
  `

  const mapDeadInvocations = `
    function (doc) {
      if (doc.status === 'completed' || doc.status === 'failed') {
        emit([doc.functionName, doc.createdAt], null)
      }
    }
  `

  await design(store.invocations, {
    _id: '_design/default',
    views: {
      by_project: {
        map: mapInvocationsByProject,
      },
      alive: {
        map: mapAliveInvocations,
      },
      dead: {
        map: mapDeadInvocations,
      },
    },
  })

  const mapProjectsByName = `
    function (doc) {
      emit([doc.name, doc.createdAt], null)
    }
  `

  const mapProjectsByUser = `
    function (doc) {
      if (!doc.draft) {
        emit('admin', [doc.name])
        for (var username in Object(doc.roles)) {
          if (username !== 'admin') {
            emit(username, [doc.name])
          }
        }
      }
    }
  `

  await design(store.projects, {
    _id: '_design/default',
    views: {
      by_name: {
        map: mapProjectsByName,
      },
      by_user: {
        map: mapProjectsByUser,
        reduce: reduceArrays,
      },
    },
  })

  const projectName = 'default'
  await store.projects
    .read({
      _design: 'default',
      _view: 'by_name',
      startkey: [projectName, null],
      endkey: [projectName, {}],
    })
    .ensure(() => ({
      ...createProject(projectName),
      draft: undefined,
    }))
    .consume()
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
