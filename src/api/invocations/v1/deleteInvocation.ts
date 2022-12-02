import type { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'

import { getPodByInvocationId } from '../lib/kubernetes.js'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

const route: RouteOptions = {
  method: 'DELETE',
  url: '/api/v1/invocations/:invocationId',
  schema: {
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      204: S.null(),
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

    const pod = await getPodByInvocationId(kubernetes, invocation._id!)
    if (pod) {
      await kubernetes.api.CoreV1Api.deleteNamespacedPod(
        pod.metadata?.name!,
        kubernetes.namespace,
      )
    }

    await database.invocations.from(invocation).delete().unwrap()

    reply.code(204)
    return null
  },
}

export default route
