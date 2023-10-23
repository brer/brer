import type { FastifyInstance } from '@brer/types'
import S from 'fluent-json-schema-es'

import { getFunctionId } from '../../../lib/function.js'
import { getLabelSelector } from '../../../lib/kubernetes.js'

interface RouteGeneric {
  Params: {
    functionName: string
  }
}

export default (fastify: FastifyInstance) =>
  fastify.route<RouteGeneric>({
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
      const { database, kubernetes, tasks } = this
      const { params } = request

      const fn = await database.functions
        .find(getFunctionId(params.functionName))
        .unwrap()

      if (!fn) {
        return reply.code(404).error({ message: 'Function not found.' })
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

      await database.functions.from(fn).delete().consume()

      tasks.push(async log => {
        const count = await database.invocations
          .filter({ functionName: fn.name })
          .delete()
          .consume()

        log.debug(`deleted ${count} ${fn.name} invocation(s)`)
      })

      return reply.code(204).send()
    },
  })
