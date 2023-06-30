import type { RouteOptions } from '@brer/types'
import S from 'fluent-json-schema-es'

import { getFunctionId } from '../../../lib/function.js'

interface RouteGeneric {
  Params: {
    functionName: string
  }
}

const route: RouteOptions<RouteGeneric> = {
  method: 'GET',
  url: '/api/v1/functions/:functionName',
  schema: {
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
      return reply.code(404).error()
    }

    return { function: fn }
  },
}

export default route
