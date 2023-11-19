import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import S from 'fluent-json-schema-es'

import { parseAuthorization } from '../lib/header.js'
import {
  completeInvocation,
  failInvocation,
  progressInvocation,
  pushLines,
  runInvocation,
} from '../lib/invocation.js'
import { decodeToken } from '../lib/token.js'
import { isOlderThan, tail } from '../lib/util.js'
import { handleTestInvocation, rotateInvocations } from './util.js'

declare module 'fastify' {
  interface FastifyRequest {
    invocation: Invocation
  }
}

export default async function rpcPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('invocation', null)

  fastify.addHook('onRequest', async (request, reply) => {
    const { headers, log } = request

    const authorization = parseAuthorization(headers)

    const raw = authorization?.type === 'bearer' ? authorization.token : null
    if (!raw) {
      return reply.code(401).sendError({
        code: 'UNAUTHORIZED',
        message: 'Auth info not provided.',
      })
    }

    try {
      const token = decodeToken(raw)
      if (token) {
        const invocation = await fastify.store.invocations
          .find(token.id)
          .unwrap()
        if (invocation) {
          if (
            !invocation.tokenSignature ||
            invocation.tokenSignature === token.signature
          ) {
            request.invocation = invocation
          }
        }
      }
    } catch (err) {
      log.debug({ token: raw, err }, 'unknown invocation token')
    }

    if (!request.invocation) {
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
      const { invocation } = request

      if (invocation?.status !== 'pending') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      this.events.emit('brer.invocations.invoke', { invocation })
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
      const { store } = this

      const invocation = await store.invocations
        .from(request.invocation)
        .update(doc =>
          doc.status === 'initializing' ? runInvocation(doc) : doc,
        )
        .unwrap()

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
      const { store } = this
      const { invocation } = request

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

      const buffer = await store.invocations.adapter.scope.attachment.get(
        invocation._id,
        'payload',
      )

      reply.type(attachment.content_type!)
      return buffer
    },
  })

  fastify.route<{ Body: { result: unknown } }>({
    method: 'POST',
    url: '/rpc/v1/progress',
    schema: {
      body: S.object().prop('result'),
    },
    async handler(request, reply) {
      const { store } = this
      const { body } = request

      if (!isOlderThan(tail(request.invocation.phases)!.date, 2)) {
        return reply.code(409).error({
          message: 'Cannot progress an Invocation too quickly',
        })
      }

      const invocation = await store.invocations
        .from(request.invocation)
        .update(doc =>
          doc.status === 'running' ? progressInvocation(doc, body.result) : doc,
        )
        .unwrap()

      if (invocation?.status !== 'running') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      return reply.code(204).send()
    },
  })

  fastify.route<{ Body: { result: unknown } }>({
    method: 'POST',
    url: '/rpc/v1/complete',
    schema: {
      body: S.object().prop('result'),
    },
    async handler(request, reply) {
      const { store } = this
      const { body } = request

      const invocation = await store.invocations
        .from(request.invocation)
        .update(doc =>
          doc.status === 'running' ? completeInvocation(doc, body.result) : doc,
        )
        .tap(doc => handleTestInvocation(store, doc)) // update function before its invocation
        .unwrap()

      if (invocation?.status !== 'completed') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      await rotateInvocations(this, invocation.functionName)

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
      const { store } = this
      const { body } = request

      const invocation = await store.invocations
        .from(request.invocation)
        .update(doc =>
          doc.status !== 'completed' ? failInvocation(doc, body.reason) : doc,
        )
        .tap(doc => handleTestInvocation(store, doc)) // update function before its invocation
        .unwrap()

      if (invocation?.status !== 'failed') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      await rotateInvocations(this, invocation.functionName)

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
      const { store } = this
      const { body } = request

      const buffer = Buffer.from(body, 'utf-8')

      const invocation = await store.invocations
        .from(request.invocation)
        .update(doc =>
          doc.status === 'running' ? pushLines(doc, buffer) : doc,
        )
        .unwrap()

      if (invocation?.status !== 'running') {
        return reply.code(409).error({
          message: 'Invalid Invocation status.',
        })
      }

      return reply.code(204).send()
    },
  })
}
