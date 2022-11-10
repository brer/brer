import { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'

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
      .additionalProperties(false)
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
        .additionalProperties(false)
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
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
      // TODO: 404
      throw new Error('Function not found')
    }

    return { function: fn }
  },
}

export default route
