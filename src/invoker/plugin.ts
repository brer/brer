import type { FastifyInstance, FastifyRequest } from 'fastify'
import S from 'fluent-json-schema-es'

import auth from './auth.js'
import watch from './watch.js'
import {
  completeInvocation,
  failInvocation,
  runInvocation,
} from '../api/invocations/lib/invocation.js'

interface RouteGeneric {
  Body: {
    reason?: string
    result?: string
  }
}

export default async function invokerPlugin(fastify: FastifyInstance) {
  fastify.log.debug('invoker plugin is enabled')

  fastify.register(auth)
  fastify.register(watch)

  fastify.route({
    method: 'POST',
    url: '/rpc/v1/run',
    schema: {
      body: S.object(),
    },
    async handler(request, reply) {
      const { database } = this
      const { invocationId } = request

      const invocation = await database.invocations
        .read(invocationId)
        .update(runInvocation)
        .unwrap()

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

  fastify.route({
    method: 'POST',
    url: '/rpc/v1/complete',
    schema: {
      body: S.object().prop('result'),
    },
    async handler(request, reply) {
      const { database } = this
      const { body, invocationId } = request as FastifyRequest<RouteGeneric>

      const invocation = await database.invocations
        .read(invocationId)
        .update(doc => completeInvocation(doc, body.result))
        .unwrap()

      return { invocation }
    },
  })

  fastify.route({
    method: 'POST',
    url: '/rpc/v1/fail',
    schema: {
      body: S.object().prop('reason'),
    },
    async handler(request, reply) {
      const { database } = this
      const { body, invocationId } = request as FastifyRequest<RouteGeneric>

      const invocation = await database.invocations
        .read(invocationId)
        .update(doc => failInvocation(doc, body.reason))
        .unwrap()

      return { invocation }
    },
  })
}
