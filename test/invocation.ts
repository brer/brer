import test from 'ava'

import { setTokenSignature } from '../src/lib/invocation.js'
import { encodeToken } from '../src/lib/token.js'
import createTestServer from './_server.js'

test('happy path', async t => {
  const { authorization, fastify } = createTestServer()
  t.teardown(() => fastify.close())

  await fastify.ready()

  const functionName = 'my-test-function'

  fastify.helmsman.pushFunctionSecrets = async (name, secrets) => {
    t.is(name, functionName)
    t.deepEqual(secrets, { stamper: 'Emphasis on Scat' })
  }

  const resCreate = await fastify.inject({
    method: 'PUT',
    url: `/api/v1/functions/${functionName}`,
    headers: {
      authorization,
    },
    payload: {
      image: `127.0.0.1:3000/${functionName}:latest`,
      env: [
        {
          name: 'PRIVATE_SECRET',
          secretKey: 'stamper',
          value: 'Emphasis on Scat',
        },
      ],
    },
  })
  t.like(resCreate, {
    statusCode: 201,
  })
  t.like(resCreate.json(), {
    function: {
      name: functionName,
      image: {
        host: '127.0.0.1:3000',
        name: functionName,
        tag: 'latest',
      },
      project: 'default',
      env: [
        {
          name: 'PRIVATE_SECRET',
          secretKey: 'stamper',
          value: undefined,
        },
      ],
    },
    invocation: {
      functionName,
      project: 'default',
      status: 'pending',
    },
  })

  const invocationId = resCreate.json().invocation._id
  const token = encodeToken(invocationId)

  await fastify.store.invocations
    .read(invocationId)
    .tap(doc => t.is(doc.status, 'initializing'))
    .update(doc => setTokenSignature(doc, token.signature))
    .unwrap()

  const resRun = await fastify.inject({
    method: 'POST',
    url: '/rpc/v1/run',
    headers: {
      authorization: `Bearer ${token.value}`,
    },
    payload: {},
  })
  t.like(resRun, {
    statusCode: 200,
  })
  t.like(resRun.json(), {
    invocation: {
      _id: invocationId,
      status: 'running',
      env: [
        {
          name: 'BRER_MODE',
          value: 'test',
        },
      ],
    },
  })
})
