import type { FastifyRequest, RouteOptions } from 'fastify'
import S from 'fluent-json-schema-es'

import { getFunctionId } from '../../../lib/function.js'

interface RouteGeneric {
  Body: {
    env?: any[]
    image: string
    name: string
  }
}

const route: RouteOptions = {
  method: 'POST',
  url: '/api/v1/functions',
  schema: {
    body: S.object()
      .additionalProperties(false)
      .prop(
        'name',
        S.string()
          .minLength(3)
          .maxLength(256)
          .pattern(/^[a-z][0-9a-z\-]+[0-9a-z]$/),
      )
      .required()
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
      201: S.object()
        .additionalProperties(false)
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { database } = this
    const { body } = request as FastifyRequest<RouteGeneric>

    // TODO: ensure env name uniqueness and prevent usage of "BRER_" prefix
    const fn = await database.functions
      .create({
        _id: getFunctionId(body.name),
        name: body.name,
        image: body.image,
        env: body.env ?? [],
      })
      .unwrap()

    reply.code(201)
    return { function: fn }
  },
}

export default route
