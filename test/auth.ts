import test from 'ava'

import createTestServer from './_server.js'

const fastify = createTestServer()
test.before(() => fastify.ready())
test.after(() => fastify.close())

const authorization = 'Basic ' + Buffer.from('admin:admin').toString('base64')

test('server authentication', async t => {
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
