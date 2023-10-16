import type { FastifyInstance } from '@brer/types'
import plugin from 'fastify-plugin'
import S from 'fluent-json-schema-es'

import {
  completeInvocation,
  failInvocation,
  pushLines,
  runInvocation,
} from '../lib/invocation.js'
import { decodeToken } from '../lib/token.js'

declare module 'fastify' {
  interface FastifyRequest {
    invocationId: string
  }
}

async function rpcPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('invocationId', null)

  fastify.addHook('onRequest', async (request, reply) => {
    const { headers, log } = request

    const value =
      typeof headers.authorization === 'string' &&
      /^Bearer ./.test(headers.authorization)
        ? headers.authorization.substring(7)
        : null

    if (!value) {
      return reply.code(401).sendError({
        code: 'UNAUTHORIZED',
        message: 'Auth info not provided.',
      })
    }

    try {
      const token = decodeToken(value)
      if (token) {
        const invocation = await fastify.database.invocations
          .find(token.id)
          .unwrap()
        if (invocation) {
          if (
            !invocation.tokenSignature ||
            invocation.tokenSignature === token.signature
          ) {
            request.invocationId = invocation._id
          }
        }
      }
    } catch (err) {
      log.debug({ token: value, err }, 'unknown invocation token')
    }

    if (!request.invocationId) {
      return reply.code(403).sendError({
        code: 'TOKEN_INVALID',
        message: 'Auth token not valid.',
      })
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
      if (invocation?.status !== 'pending') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      this.events.emit('rpc.action.invoke', { invocation })
      return reply.code(204).send()
    },
  })

  fastify.route({
    method: 'POST',
    url: '/rpc/v1/run',
    schema: {
      body: S.object(),
    },
    async handler(request, reply) {
      const { database } = this
      const { invocationId } = request

      const invocation = await database.transaction(() =>
        database.invocations
          .find(invocationId)
          .update(doc =>
            doc.status === 'initializing' ? runInvocation(doc) : doc,
          )
          .unwrap(),
      )
      if (invocation?.status !== 'running') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

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
      if (invocation?.status !== 'running') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      const attachment = invocation?._attachments?.payload
      if (!attachment) {
        // Empty payloads can be valid
        return reply.code(204).send()
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
    async handler(request, reply) {
      const { database } = this
      const { body, invocationId } = request

      const invocation = await database.transaction(() =>
        database.invocations
          .find(invocationId)
          .update(doc =>
            doc.status === 'running'
              ? completeInvocation(doc, body.result)
              : doc,
          )
          .unwrap(),
      )
      if (invocation?.status !== 'completed') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      return reply.code(204).send()
    },
  })

  fastify.route<{ Body: { reason: any } }>({
    method: 'POST',
    url: '/rpc/v1/fail',
    schema: {
      body: S.object().prop('reason'),
    },
    async handler(request, reply) {
      const { database } = this
      const { body, invocationId } = request

      const invocation = await database.transaction(() =>
        database.invocations
          .find(invocationId)
          .update(doc =>
            doc.status !== 'completed' ? failInvocation(doc, body.reason) : doc,
          )
          .unwrap(),
      )
      if (invocation?.status !== 'failed') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      return reply.code(204).send()
    },
  })

  fastify.route<{ Body: string }>({
    method: 'POST',
    url: '/rpc/v1/log',
    schema: {
      body: S.string(),
    },
    async handler(request, reply) {
      const { database } = this
      const { body, invocationId } = request

      const buffer = Buffer.from(body, 'utf-8')

      const invocation = await database.transaction(() =>
        database.invocations
          .find(invocationId)
          .update(doc =>
            doc.status === 'running' ? pushLines(doc, buffer) : doc,
          )
          .unwrap(),
      )
      if (invocation?.status !== 'running') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      return reply.code(204).send()
    },
  })
}

export default plugin(rpcPlugin, {
  name: 'rpc',
  decorators: {
    fastify: ['database', 'events'],
  },
  encapsulate: true,
})
