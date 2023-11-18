import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { failInvocation } from '../../../lib/invocation.js'
import { getLabelSelector } from '../../../lib/kubernetes.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'POST',
  url: '/api/v1/invocations/:invocationId/stop',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      200: S.object()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { auth, kubernetes, store } = this
    const { params, session } = request

    const oldInvocation = await store.invocations
      .find(params.invocationId)
      .unwrap()
    if (!oldInvocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
    }

    const result = await auth.authorize(
      session,
      'invoker',
      oldInvocation.project,
    )
    if (result.isErr) {
      return reply.code(403).error(result.unwrapErr())
    }

    if (
      oldInvocation.status === 'completed' ||
      oldInvocation.status === 'failed'
    ) {
      return reply.code(409).error({
        message: 'Invocation not running.',
        info: { status: oldInvocation.status },
      })
    }

    // TODO: call controller (stop invocation)
    const newInvocation = await store.invocations
      .from(oldInvocation)
      .update(i => failInvocation(i, 'stopped manually'))
      .unwrap()

    // TODO: call controller (stop invocation)
    await kubernetes.api.CoreV1Api.deleteCollectionNamespacedPod(
      kubernetes.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      getLabelSelector({ invocationId: params.invocationId }),
    )

    return { invocation: newInvocation }
  },
})
