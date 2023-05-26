import type { FastifyRequest, RouteOptions } from 'fastify'
import S from 'fluent-json-schema-es'

interface RouteGeneric {
  Params: {
    functionName: string
  }
}

const route: RouteOptions = {
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
      404: S.object()
        .prop('error', S.ref('https://brer.io/schema/v1/error.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { database } = this
    const { params } = request as FastifyRequest<RouteGeneric>

    const fn = await database.functions
      .find({ name: params.functionName })
      .unwrap()

    if (!fn) {
      return reply.code(404).error()
    }

    return { function: fn }
  },
}

export default route
