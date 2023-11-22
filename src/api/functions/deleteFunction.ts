import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'
import { type Pool } from 'undici'

import { getFunctionByName } from '../../lib/function.js'
import { deleteInvocation } from '../invocations/deleteInvocation.js'

export interface RouteGeneric {
  Params: {
    functionName: string
  }
}

export default (invoker: Pool): RouteOptions<RouteGeneric> => ({
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
    const { auth, store, tasks } = this
    const { log, params, session } = request

    const fn = await getFunctionByName(store, params.functionName)
    if (!fn) {
      return reply.code(404).error({ message: 'Function not found.' })
    }

    const result = await auth.authorize(session, 'viewer', fn.project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    await store.functions.from(fn).delete().consume()

    tasks.push(() =>
      store.invocations
        .filter({
          _design: 'default',
          _view: 'by_project',
          startkey: [fn.project, fn.name, null],
          endkey: [fn.project, fn.name, {}],
        })
        .tap(async doc => {
          const result = await deleteInvocation(
            invoker,
            session.username,
            doc._id,
          )
          if (result.isErr) {
            log.error(
              { invocationId: doc._id, err: result.unwrapErr() },
              'failed to delete invocation',
            )
          }
        })
        .consume({ sorted: false }),
    )

    return reply.code(204).send()
  },
})
