import type { Invocation } from '@brer/types'
import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'
import Queue from 'fastq'
import S from 'fluent-json-schema-es'

import { handleInvocation } from '../api/invocations/lib/invocation.js'
import {
  getLabelSelector,
  getPodTemplate,
} from '../api/invocations/lib/kubernetes.js'
import { encodeToken } from '../lib/token.js'

async function watchPlugin(fastify: FastifyInstance) {
  const { database, log } = fastify

  let closed: boolean = false
  let reschedule: boolean = false
  let timer: NodeJS.Timer | null = null

  const queue = Queue.promise(
    (invocation: Invocation) =>
      syncInvocationStatus(fastify, invocation).catch(err => {
        log.error(
          { invocationId: invocation._id, err },
          'error processing an invocation',
        )
        reschedule = true
      }),
    16,
  )

  // start queue after fastify
  queue.pause()

  const pushInvocations = () => {
    if (closed) {
      return
    }
    if (!queue.idle()) {
      reschedule = true
      return
    }
    database.invocations
      .filter({
        status: {
          $in: ['pending', 'initializing'],
        },
      })
      .tap(invocation => {
        // ignore the returned Promise (prevent iteration lock)
        queue.push(invocation)
      })
      .consume()
      .catch(err => {
        log.error({ err }, 'error while locading invocations')
        process.nextTick(pushInvocations)
      })
  }

  queue.drain = () => {
    if (reschedule) {
      reschedule = false
      process.nextTick(pushInvocations)
    }
  }

  fastify.addHook('onReady', async () => {
    queue.resume()
    process.nextTick(pushInvocations)
    timer = setInterval(pushInvocations, 60000)
  })

  fastify.addHook('onClose', async () => {
    closed = true
    if (timer) {
      clearInterval(timer)
    }
    if (!queue.idle()) {
      log.info({ length: queue.length() }, 'waiting for queue to drain')
      await queue.drained()
    }
  })

  fastify.route<{ Body: { invocationId: string } }>({
    method: 'POST',
    url: '/rpc/v1/invoke',
    schema: {
      body: S.object()
        .prop('invocationId', S.string().format('uuid'))
        .required(),
    },
    async handler(request, reply) {
      const invocation = await database.invocations
        .find(request.body.invocationId)
        .unwrap()

      if (invocation) {
        queue.push(invocation)
      }

      reply.code(202)
      return {}
    },
  })
}

async function syncInvocationStatus(
  { database, kubernetes, log }: FastifyInstance,
  invocation: Invocation,
) {
  const invocationId = invocation._id!

  // lock the document (this process will sync its status with kubernetes)
  log.debug({ invocationId }, 'handle invocation')
  invocation = await database.invocations
    .from(invocation)
    .update(obj =>
      obj.status === 'initializing'
        ? { ...obj, updatedAt: new Date().toISOString() }
        : handleInvocation(obj),
    )
    .unwrap()

  const response = await kubernetes.api.CoreV1Api.listNamespacedPod(
    kubernetes.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    getLabelSelector({ invocationId: invocation._id }),
    1,
  )
  if (!response.body.items.length) {
    const token = encodeToken(invocationId)

    const url =
      process.env.PUBLIC_URL ||
      `http://brer-invoker.${kubernetes.namespace}.svc.cluster.local/`

    log.debug({ invocationId }, 'spawn pod')
    await kubernetes.api.CoreV1Api.createNamespacedPod(
      kubernetes.namespace,
      getPodTemplate(invocation, url, token),
    )
  } else {
    log.debug({ invocationId }, 'skip pod creation')
  }
}

export default plugin(watchPlugin, {
  name: 'watch',
  decorators: {
    fastify: ['database', 'kubernetes'],
  },
})
