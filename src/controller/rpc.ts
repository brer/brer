import type { Invocation } from '@brer/types'
import type { FastifyInstance } from 'fastify'
import plugin from 'fastify-plugin'
import S from 'fluent-json-schema-es'

import {
  completeInvocation,
  failInvocation,
  runInvocation,
} from '../lib/invocation.js'
import { decodeToken } from '../lib/token.js'

declare module 'fastify' {
  interface FastifyRequest {
    invocationId: string
  }
}

export interface PluginOptions {
  callback: (invocation: Invocation) => void
}

async function rpcPlugin(fastify: FastifyInstance, options: PluginOptions) {
  fastify.decorateRequest('invocationId', null)

  const noAuth = {
    error: {
      code: 'UNAUTHORIZED',
      message: 'Auth info not provided.',
    },
  }

  const invalidToken = {
    error: {
      code: 'TOKEN_INVALID',
      message: 'Auth token not valid.',
    },
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const { headers, log } = request

    const value =
      typeof headers.authorization === 'string' &&
      /^Bearer ./.test(headers.authorization)
        ? headers.authorization.substring(7)
        : null

    if (!value) {
      return reply.code(401).send(noAuth)
    }

    try {
      const token = decodeToken(value)
      if (token) {
        const invocation = await fastify.database.invocations
          .find(token.id)
          .unwrap()

        if (invocation?.tokenSignature === token.signature) {
          request.invocationId = invocation._id
        }
      }
    } catch (err) {
      log.debug({ token: value, err }, 'unknown invocation token')
    }

    if (!request.invocationId) {
      return reply.code(403).send(invalidToken)
    }
  })

  fastify.route({
    method: 'POST',
    url: '/rpc/v1/invoke',
    schema: {
      body: S.object(),
    },
    async handler(request, reply) {
      const { database } = this

      const invocation = await database.invocations
        .find(request.invocationId)
        .unwrap()

      if (invocation?.status === 'pending') {
        // Spawn Pod
        options.callback(invocation)
      }

      reply.code(202)
      return {}
    },
  })

  fastify.route({
    method: 'POST',
    url: '/rpc/v1/run',
    schema: {
      body: S.object(),
    },
    async handler(request) {
      const { database } = this
      const { invocationId } = request

      const invocation = await database.transaction(() =>
        database.invocations.read(invocationId).update(runInvocation).unwrap(),
      )

      // Collect Pod logs
      options.callback(invocation)

      return { invocation }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/rpc/v1/download',
    schema: {
      body: S.object(),
    },
    async handler(request, reply) {
      const { database } = this
      const { invocationId } = request

      const invocation = await database.invocations.find(invocationId).unwrap()
      if (invocation && invocation.status !== 'running') {
        return reply.code(403).error()
      }

      const attachment = invocation?._attachments?.payload
      if (!attachment) {
        return reply.code(404).error()
      }

      const payload = await database.invocations.adapter.readAttachment(
        invocation,
        'payload',
      )

      reply.type(attachment.content_type!)
      return payload
    },
  })

  fastify.route<{ Body: { result: any } }>({
    method: 'POST',
    url: '/rpc/v1/complete',
    schema: {
      body: S.object().prop('result'),
    },
    async handler(request) {
      const { database } = this
      const { body, invocationId } = request

      const invocation = await database.transaction(() =>
        database.invocations
          .read(invocationId)
          .update(doc => completeInvocation(doc, body.result))
          .unwrap(),
      )

      return { invocation }
    },
  })

  fastify.route<{ Body: { reason: any } }>({
    method: 'POST',
    url: '/rpc/v1/fail',
    schema: {
      body: S.object().prop('reason'),
    },
    async handler(request) {
      const { database } = this
      const { body, invocationId } = request

      const invocation = await database.transaction(() =>
        database.invocations
          .read(invocationId)
          .update(doc => failInvocation(doc, body.reason))
          .unwrap(),
      )

      return { invocation }
    },
  })
}

export default plugin(rpcPlugin, {
  name: 'rpc',
  decorators: {
    fastify: ['database'],
  },
  encapsulate: true,
})
