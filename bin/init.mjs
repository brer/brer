#!/usr/bin/env node

import HttpAgent, { HttpsAgent } from 'agentkeepalive'
import minimist from 'minimist'
import nano from 'nano'
import { read } from 'read'
import { v4 as uuid } from 'uuid'

const args = minimist(process.argv.slice(2))

const couch = await createServerScope()

console.log('test couchdb connection')
await couch.info()

const brerUsername = await ask({
  prompt: 'brer username: ',
  default: args['brer-username'] || 'brer',
  edit: true,
})

const brerPassword = await ask({
  prompt: 'brer password: ',
  default: args['brer-password'],
  silent: true,
  replace: '*',
})

if (brerPassword) {
  console.log(`ensure brer user`)
  await pushDatabase('_users')
  await pushDocument(couch.scope('_users'), {
    _id: 'org.couchdb.user:' + brerUsername,
    name: brerUsername,
    password: brerPassword,
    type: 'user',
    roles: [],
  })
} else {
  console.log('skip brer user update')
}

const dbFunctions = couch.scope('functions')
const dbInvocations = couch.scope('invocations')
const dbProjects = couch.scope('projects')

console.log('init databases')
await Promise.all([
  pushDatabase(dbFunctions.config.db, brerUsername),
  pushDatabase(dbInvocations.config.db, brerUsername),
  pushDatabase(dbProjects.config.db, brerUsername),
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
await pushDocument(dbFunctions, {
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
await pushDocument(dbInvocations, {
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
await pushDocument(dbProjects, {
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
const response = await dbProjects.view('default', 'by_name', {
  startkey: [projectName, null],
  endkey: [projectName, {}],
  limit: 1,
  sorted: true,
  stable: true,
  update: 'true',
})
if (!response.rows.length) {
  await dbProjects.insert({
    _id: uuid(),
    name: projectName,
    roles: {},
  })
}

console.log('all done')

/**
 * Ask input from user, also handle "no input" sessions.
 */
async function ask(options) {
  if (args.input === false) {
    return options.default
  }
  const result = await read(options)
  if (result) {
    return result
  }
}

/**
 * Create base `nano` instance.
 */
async function createServerScope() {
  const url = await ask({
    prompt: 'couchdb url: ',
    default: args['couchdb-url'] || 'http://127.0.0.1:5984/',
    edit: true,
  })

  const username = await ask({
    prompt: 'couchdb username: ',
    default: args['couchdb-username'] || 'admin',
    edit: true,
  })

  const password = await ask({
    prompt: 'couchdb password: ',
    default: args['couchdb-password'],
    silent: true,
    replace: '*',
  })

  const agent = /^https/i.test(url) ? new HttpsAgent() : new HttpAgent()
  return nano({
    url,
    requestDefaults: {
      agent,
      auth: {
        username,
        password,
      },
      timeout: 10000,
    },
  })
}

/**
 * Push a new database and also configure `brer` member.
 */
async function pushDatabase(databaseName, username) {
  try {
    await couch.db.create(databaseName)
  } catch (err) {
    if (Object(err).statusCode !== 412) {
      return Promise.reject(err)
    }
  }

  if (username) {
    await couch.request({
      method: 'PUT',
      db: databaseName,
      doc: '_security',
      body: {
        members: {
          names: [username],
        },
      },
    })
  }
}

/**
 * Create or update a document by identifier (`_id` property is required).
 */
async function pushDocument(scope, doc) {
  try {
    const result = await scope.get(doc._id)
    doc = Object.assign(result, doc)
  } catch (err) {
    if (Object(err).statusCode !== 404) {
      return Promise.reject(err)
    }
  }
  await scope.insert(doc)
}
