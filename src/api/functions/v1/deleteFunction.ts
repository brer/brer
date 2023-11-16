import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getFunctionByName } from '../../../lib/function.js'
import { getLabelSelector } from '../../../lib/kubernetes.js'

export interface RouteGeneric {
  Params: {
    functionName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'DELETE',
  url: '/api/v1/functions/:functionName',
  schema: {
    tags: ['function'],
    params: S.object()
      .prop(
        'functionName',
        S.string()
          .minLength(3)
          .maxLength(256)
          .pattern(/^[a-z][0-9a-z\-]+[0-9a-z]$/),
      )
      .required(),
    response: {
      204: S.null(),
    },
  },
  async handler(request, reply) {
    const { auth, kubernetes, store, tasks } = this
    const { params, session } = request

    const fn = await getFunctionByName(store, params.functionName)
    if (!fn) {
      return reply.code(404).error({ message: 'Function not found.' })
    }

    const result = await auth.authorize(session, 'viewer', fn.project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    await kubernetes.api.CoreV1Api.deleteCollectionNamespacedPod(
      kubernetes.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      getLabelSelector({ functionName: fn.name }),
    )

    await store.functions.from(fn).delete().consume({ purge: true })

    tasks.push(async log => {
      const count = await store.invocations
        .filter({
          _design: 'default',
          _view: 'by_project',
          startkey: [fn.project, fn.name, null],
          endkey: [fn.project, fn.name, {}],
        })
        .delete()
        .consume({
          purge: true,
          sorted: false,
        })

      log.debug(`deleted ${count} ${fn.name} invocation(s)`)
    })

    return reply.code(204).send()
  },
})
