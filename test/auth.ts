import test from 'ava'

import { basicAuthorization } from '../src/lib/header.js'
import createTestServer from './_server.js'

const adminPassword = 'auth_test'
const authorization = basicAuthorization('admin', adminPassword)

const fastify = createTestServer(adminPassword)
test.before(() => fastify.ready())
test.after(() => fastify.close())

test('get session', async t => {
  const anonymous = await fastify.inject({
    method: 'GET',
    url: '/api/session',
  })
  t.like(anonymous, {
    statusCode: 200,
  })
  t.deepEqual(anonymous.json(), {
    authenticated: false,
  })

  const authenticated = await fastify.inject({
    method: 'GET',
    url: '/api/session',
    headers: {
      authorization,
    },
  })
  t.like(authenticated, {
    statusCode: 200,
  })
  t.deepEqual(authenticated.json(), {
    authenticated: true,
    session: {
      type: 'basic',
    },
    user: {
      projects: ['default'],
      username: 'admin',
    },
  })
})

test('create session', async t => {
  const response = await fastify.inject({
    method: 'POST',
    url: '/api/session',
    body: {
      username: 'admin',
      password: adminPassword,
    },
  })
  t.like(response, {
    statusCode: 201,
  })
  t.truthy(response.headers['set-cookie'])
  t.like(response.json(), {
    authenticated: true,
    session: {
      type: 'cookie',
    },
    user: {
      username: 'admin',
    },
  })
})
