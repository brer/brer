import test from 'ava'

import createTestServer from './_server.js'

test('happy path', async t => {
  t.plan(12)

  const { authorization, fastify } = createTestServer()
  t.teardown(() => fastify.close())

  await fastify.ready()

  const { raw: adminToken } = await fastify.token.signApiToken('admin')

  const functionName = `test-${Date.now()}`

  fastify.helmsman.pushFunctionSecrets = async (name, secrets) => {
    t.is(name, functionName)
    t.deepEqual(secrets, { stamper: 'Emphasis on Scat' })
  }

  let podToken: string | undefined
  const podCreated = new Promise<void>(resolve => {
    // Close this Promise at shutdown
    t.teardown(resolve)

    fastify.helmsman.createPod = async template => {
      t.is(
        template.spec?.containers[0].image,
        `zombo.com/${functionName}:latest`,
      )

      // Save Pod token for later
      podToken = template.spec?.containers[0].env?.find(
        item => item.name === 'BRER_TOKEN',
      )?.value

      process.nextTick(resolve)
      return template
    }
  })

  const resCreate = await fastify.inject({
    method: 'PUT',
    url: `/api/v1/functions/${functionName}`,
    headers: {
      authorization,
    },
    payload: {
      image: `zombo.com/${functionName}:latest`,
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
        host: 'zombo.com',
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
      status: 'pending', // create with "pending" status
    },
  })

  const invocationId = resCreate.json().invocation._id

  await podCreated

  await fastify.store.invocations
    .read(invocationId)
    .tap(doc => t.is(doc.status, 'initializing')) // "initializing" status after pod start
    .unwrap()

  const resRun = await fastify.inject({
    method: 'PUT',
    url: `/invoker/v1/invocations/${invocationId}`,
    headers: {
      authorization: `Bearer ${podToken}`,
    },
    payload: {
      status: 'running',
    },
  })
  t.like(resRun, {
    statusCode: 200,
  })
  t.like(resRun.json(), {
    invocation: {
      _id: invocationId,
      status: 'running', // "running" status after this ping
      functionName,
    },
  })

  // API tokens cannot use Invoker routes to directly update Invocations
  const resNope = await fastify.inject({
    method: 'PUT',
    url: `/invoker/v1/invocations/${invocationId}`,
    headers: {
      authorization: 'Bearer ' + adminToken,
    },
    payload: {
      status: 'completed',
    },
  })
  t.like(resNope, {
    statusCode: 403,
  })

  const resLog = await fastify.inject({
    method: 'PUT',
    url: `/invoker/v1/invocations/${invocationId}/log/0`,
    headers: {
      accept: '*/*',
      authorization: `Bearer ${podToken}`,
      'content-type': 'text/plain; charset=utf-8',
    },
    payload: 'Thank you for flying with us.',
  })
  t.like(resLog, {
    statusCode: 204,
  })

  const resComplete = await fastify.inject({
    method: 'PUT',
    url: `/invoker/v1/invocations/${invocationId}`,
    headers: {
      authorization: `Bearer ${podToken}`,
    },
    payload: {
      status: 'completed',
      result: {
        hello: 'world',
      },
    },
  })
  t.like(resComplete, {
    statusCode: 200,
  })
  t.like(resComplete.json(), {
    invocation: {
      _id: invocationId,
      functionName,
      status: 'completed',
    },
  })
})
