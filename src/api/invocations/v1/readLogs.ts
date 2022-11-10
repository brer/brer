import { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'

import { getLabelSelector } from '../lib/kubernetes.js'

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
  },
  async handler(request, reply) {
    const { database, kubernetes } = this
    const { params } = request as FastifyRequest<RouteGeneric>

    const invocation = await database.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      // TODO: 404
      throw new Error('Invocation not found')
    }

    const result = await kubernetes.api.CoreV1Api.listNamespacedPod(
      kubernetes.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      getLabelSelector({ invocationId: invocation._id }),
      1,
    )

    let logs = ''

    const pod = result.body.items[0]
    if (pod) {
      const { body } = await kubernetes.api.CoreV1Api.readNamespacedPodLog(
        pod.metadata!.name!,
        kubernetes.namespace,
      )
      logs = body
    }

    reply.type('text/html')
    return logs
  },
}

export default route
