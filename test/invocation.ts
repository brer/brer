import test from 'ava'

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

  let podToken: string | undefined
  const podCreated = new Promise<void>(resolve => {
    // Close this Promise at shutdown
    t.teardown(resolve)

    fastify.helmsman.createPod = async template => {
      // t.is(
      //   template.spec?.containers[0].image,
      //   `127.0.0.1:3000/${functionName}:latest`,
      // )

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
    url: `/invoker/v1/invocations/${invocationId}/status/running`,
    headers: {
      authorization: `Bearer ${podToken}`,
    },
    payload: {},
  })
  t.like(resRun, {
    statusCode: 200,
  })
  t.like(resRun.json(), {
    invocation: {
      _id: invocationId,
      status: 'running', // "running" status after this ping
    },
  })
})
