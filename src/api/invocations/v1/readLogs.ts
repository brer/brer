import type { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'

import { getPodByInvocationId } from '../lib/kubernetes.js'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

const route: RouteOptions = {
  method: 'GET',
  url: '/api/v1/invocations/:invocationId/logs',
  schema: {
    params: S.object()
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      404: S.object()
        .prop('error', S.ref('https://brer.io/schema/v1/error.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { database, kubernetes } = this
    const { params } = request as FastifyRequest<RouteGeneric>

    const invocation = await database.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      return reply.code(404).error()
    }

    let logs = ''

    const pod = await getPodByInvocationId(kubernetes, invocation._id!)
    if (pod) {
      const { body } = await kubernetes.api.CoreV1Api.readNamespacedPodLog(
        pod.metadata!.name!,
        kubernetes.namespace,
      )
      logs = body
    }

    reply.type('text/html')
    return logs || 'not found'
  },
}

export default route
