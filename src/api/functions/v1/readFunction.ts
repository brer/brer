import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getFunctionId } from '../../../lib/function.js'

interface RouteGeneric {
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
    const { database } = this
    const { params } = request

    const fn = await database.functions
      .find(getFunctionId(params.functionName))
      .unwrap()

    if (!fn) {
      return reply.code(404).error({ message: 'Function not found.' })
    }

    return { function: fn }
  },
})
