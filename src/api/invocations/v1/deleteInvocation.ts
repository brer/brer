import { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'

import { getLabelSelector } from '../lib/kubernetes.js'

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
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      204: S.null(),
    },
  },
  async handler(request, reply) {
    const { database, kubernetes } = this
    const { params } = request as FastifyRequest<RouteGeneric>

    const invocation = await database.invocations
      .find(params.invocationId)
      .delete()
      .unwrap()

    if (!invocation) {
      // TODO: 404
      throw new Error('Invocation not found')
    }

    await kubernetes.api.CoreV1Api.deleteCollectionNamespacedPod(
      kubernetes.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      getLabelSelector({ invocationId: invocation._id }),
    )

    reply.code(204)
  },
}

export default route
