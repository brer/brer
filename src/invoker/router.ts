import type { FastifyInstance, FastifyRequest } from '@brer/fastify'
import { type EventEmitter } from 'node:stream'

import { parseAuthorization } from '../lib/header.js'
import { type Token, verifyToken } from '../lib/token.js'

import completeInvocationV1 from './invocations/completeInvocation.js'
import createInvocationV1 from './invocations/createInvocation.js'
import deleteInvocationV1 from './invocations/deleteInvocation.js'
import failInvocationV1 from './invocations/failInvocation.js'
import progressInvocationV1 from './invocations/progressInvocation.js'
import pushLogV1 from './invocations/pushLog.js'
import readPayloadV1 from './invocations/readPayload.js'
import runInvocationV1 from './invocations/runInvocation.js'

declare module 'fastify' {
  interface FastifyRequest {
    token: Token
  }
}

export interface PluginOptions {
  events: EventEmitter
}

export default async function invokerAuthPlugin(
  fastify: FastifyInstance,
  { events }: PluginOptions,
) {
  fastify.decorateRequest('token', null)

  /**
   * Verify JWT token.
   */
  fastify.addHook('onRequest', async (request: FastifyRequest, reply) => {
    const { headers, log } = request

    const authorization = parseAuthorization(headers)

    const raw = authorization?.type === 'bearer' ? authorization.token : null
    if (raw) {
      try {
        request.token = await verifyToken(
          raw,
          'brer.io/invoker',
          request.routeOptions.config.tokenIssuer,
        )
      } catch (err) {
        log.debug({ err }, 'jwt verification failed')
      }
    }

    if (!request.token) {
      return reply.code(401).sendError({
        code: 'TOKEN_INVALID',
        message: 'Auth token not valid.',
      })
    }
  })

  interface MaybeInvocation {
    Params: {
      invocationId?: string
    }
  }

  /**
   * Enfore token scope for Invoker's tokens.
   */
  fastify.addHook(
    'preHandler',
    async (request: FastifyRequest<MaybeInvocation>, reply) => {
      if (
        request.params.invocationId &&
        request.token.issuer === 'brer.io/invoker' &&
        request.token.subject !== request.params.invocationId
      ) {
        return reply.sendError({ status: 404 })
      }
    },
  )

  fastify
    .route(completeInvocationV1())
    .route(createInvocationV1(events))
    .route(deleteInvocationV1())
    .route(failInvocationV1())
    .route(progressInvocationV1())
    .route(pushLogV1())
    .route(readPayloadV1())
    .route(runInvocationV1())
}
