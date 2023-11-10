import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getFunctionId } from '../../../lib/function.js'

export interface RouteGeneric {
  Params: {
    functionName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
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
      200: S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { gateway, store } = this
    const { params, session } = request

    const fn = await store.functions
      .find(getFunctionId(params.functionName))
      .unwrap()

    if (!fn) {
      return reply.code(404).error({ message: 'Function not found.' })
    }

    const result = await gateway.authorize(session.username, 'api_read', [
      fn.group,
    ])
    if (result.isErr) {
      return reply.code(403).error(result.unwrapErr())
    }

    return { function: fn }
  },
})
