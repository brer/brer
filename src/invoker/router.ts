import type { FastifyContext, FastifyInstance } from '@brer/fastify'
import type { V1Secret } from '@kubernetes/client-node'
import plugin from 'fastify-plugin'
import S from 'fluent-json-schema-es'

import { getFunctionSecretName } from '../lib/function.js'
import { API_ISSUER } from '../lib/tokens.js'

import createInvocationV1 from './invocations/createInvocation.js'
import deleteInvocationV1 from './invocations/deleteInvocation.js'
import pushLogV1 from './invocations/pushLog.js'
import readInvocationV1 from './invocations/readInvocation.js'
import readPayloadV1 from './invocations/readPayload.js'
import updateInvocationV1 from './invocations/updateInvocation.js'
import auth from './auth.js'

async function routerPlugin(fastify: FastifyInstance) {
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
      const { kubernetes } = this
      const { body, params } = request

      const secretName = getFunctionSecretName(params.functionName)

      const template: V1Secret = {
        apiVersion: 'v1',
        kind: 'Secret',
        type: 'Opaque',
        metadata: {
          name: secretName,
          labels: {
            'app.kubernetes.io/managed-by': 'brer.io',
            'brer.io/function-name': params.functionName,
          },
        },
        stringData: body,
      }

      await kubernetes.api.CoreV1Api.patchNamespacedSecret(
        secretName,
        kubernetes.namespace,
        template,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          headers: {
            'Content-Type': 'application/apply-patch+yaml',
          },
        },
      )

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
    .route(readInvocationV1())
    .route(pushLogV1())
    .route(readPayloadV1())
    .route(updateInvocationV1())
}

export default plugin(routerPlugin, {
  decorators: {
    fastify: ['events', 'invoker', 'kubernetes'],
  },
})
