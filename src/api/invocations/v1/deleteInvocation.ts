import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getLabelSelector } from '../../../lib/kubernetes.js'

interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'DELETE',
  url: '/api/v1/invocations/:invocationId',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      204: S.null(),
    },
  },
  async handler(request, reply) {
    const { kubernetes, store } = this
    const { params } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()

    if (!invocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
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

    await store.invocations.from(invocation).delete().unwrap()

    return reply.code(204).send()
  },
})
