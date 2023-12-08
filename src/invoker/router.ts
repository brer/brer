import type { FastifyContext, FastifyInstance } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getFunctionSecretName } from '../lib/function.js'
import { API_ISSUER } from '../lib/token.js'

import createInvocationV1 from './invocations/createInvocation.js'
import deleteInvocationV1 from './invocations/deleteInvocation.js'
import pushLogV1 from './invocations/pushLog.js'
import readPayloadV1 from './invocations/readPayload.js'
import updateInvocationV1 from './invocations/updateInvocation.js'
import auth from './auth.js'

export default async function routerPlugin(fastify: FastifyInstance) {
  fastify.register(auth)

  interface RouteGeneric {
    Body: Record<string, string>
    Params: {
      functionName: string
    }
  }

  fastify.route<RouteGeneric, FastifyContext>({
    method: 'PUT',
    url: '/invoker/v1/secrets/:functionName',
    config: {
      tokenIssuer: API_ISSUER,
    },
    schema: {
      params: S.object().prop('functionName', S.string()).required(),
      body: S.object().additionalProperties(S.string()).minProperties(1),
      response: {
        204: S.null(),
      },
    },
    async handler(request, reply) {
      const { helmsman } = this
      const { body, params } = request

      // TODO: handle errors
      await helmsman.pushFunctionSecrets(params.functionName, body)

      return reply.code(204).send()
    },
  })

  fastify.route<RouteGeneric, FastifyContext>({
    method: 'DELETE',
    url: '/invoker/v1/secrets/:functionName',
    config: {
      tokenIssuer: API_ISSUER,
    },
    schema: {
      params: S.object().prop('functionName', S.string()).required(),
      body: S.object(),
      response: {
        204: S.null(),
      },
    },
    async handler(request, reply) {
      const { kubernetes } = this
      const { params } = request

      // TODO: handle 404 and move into helmsman
      await kubernetes.api.CoreV1Api.deleteNamespacedSecret(
        getFunctionSecretName(params.functionName),
        kubernetes.namespace,
      )

      return reply.code(204).send()
    },
  })

  fastify
    .route(createInvocationV1())
    .route(deleteInvocationV1())
    .route(pushLogV1())
    .route(readPayloadV1())
    .route(updateInvocationV1())
}
