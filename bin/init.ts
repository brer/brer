#!/usr/bin/env -S node_modules/.bin/tsx -r dotenv/config

import type { CouchDocument, CouchStore } from 'mutent-couchdb'
import minimist from 'minimist'
import type { ViewDocument } from 'nano'

import { createProject } from '../src/lib/project.js'
import { createFastifyStore } from '../src/lib/store.js'

const args = minimist(process.argv.slice(2))

const store = createFastifyStore({
  url: args.url || process.env.COUCHDB_URL,
  username: args.username || process.env.COUCHDB_USERNAME,
  password: args.password || process.env.COUCHDB_PASSWORD,
})

console.log('test couchdb connection')
await store.nano.info()

console.log('init couchdb databases')
await Promise.all([
  store.nano.db.create(store.functions.adapter.databaseName).catch(existsOk),
  store.nano.db.create(store.invocations.adapter.databaseName).catch(existsOk),
  store.nano.db.create(store.projects.adapter.databaseName).catch(existsOk),
])

const reduceArrays = `
  function (keys, values, rereduce) {
    return values.reduce((a, b) => a.concat(b), [])
  }
`

// don't check `drafted` flag here (see `getFunctionByName` function)
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
      emit(
        [doc.image.host, doc.image.name],
        {
          name: doc.name,
          project: doc.project
        }
      )
    }
  }
`

console.log('write functions views')
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

const mapInvocationsHistory = `
  function (doc) {
    if (doc.status === 'completed' || doc.status === 'failed') {
      emit([doc.functionName, doc.createdAt], null)
    }
  }
`

console.log('write invocations views')
await design(store.invocations, {
  _id: '_design/default',
  views: {
    by_project: {
      map: mapInvocationsByProject,
    },
    alive: {
      map: mapAliveInvocations,
    },
    history: {
      map: mapInvocationsHistory,
    },
  },
})

// don't check `drafted` flag here (see `getProjectByName` function)
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

console.log('write projects views')
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

console.log('create default project')
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

console.log('all done')

function existsOk(err: unknown) {
  if (Object(err).statusCode !== 412) {
    return Promise.reject(err)
  }
}

async function design<T extends CouchDocument>(
  store: CouchStore<T>,
  doc: ViewDocument<T> & { _rev?: string },
) {
  const scope = store.adapter.scope

  try {
    const result = await scope.get(doc._id)
    doc._rev = result._rev
  } catch (err) {
    if (Object(err).statusCode !== 404) {
      return Promise.reject(err)
    }
  }

  await scope.insert(doc)
}
