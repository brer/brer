import type { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'
import * as uuid from 'uuid'

interface RouteGeneric {
  Body: {
    env?: any[]
    image: string
  }
  Params: {
    functionName: string
  }
}

const route: RouteOptions = {
  method: 'PUT',
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
    body: S.object()
      .additionalProperties(false)
      .prop('image', S.string().minLength(3).maxLength(256))
      .required()
      .prop(
        'env',
        S.array()
          .maxItems(20)
          .items(
            S.object()
              .additionalProperties(false)
              .prop(
                'name',
                S.string()
                  .minLength(1)
                  .maxLength(256)
                  .pattern(/^[0-9A-Za-z_]+$/),
              )
              .required()
              .prop('value', S.string().maxLength(4096))
              .required(),
          ),
      ),
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
    const { body, params } = request as FastifyRequest<RouteGeneric>

    const id = uuid.v4()

    // TODO: ensure function name uniqueness
    // TODO: ensure env name uniqueness and prevent usage of "BRER_" prefix
    const fn = await database.functions
      .read({ name: params.functionName })
      .ensure({
        _id: id,
        name: params.functionName,
        image: body.image,
        env: [],
      })
      .assign({
        image: body.image,
        env: body.env ?? [],
      })
      .unwrap()

    return { function: fn }
  },
}

export default route
