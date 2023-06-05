import type { FastifyInstance } from 'fastify'
import S from 'fluent-json-schema-es'

export default function (fastify: FastifyInstance) {
  fastify.addSchema(v1Schema())
}

function v1Schema() {
  return S.object()
    .additionalProperties(false)
    .id('https://brer.io/schema/v1/function.json')
    .prop('_id', S.string().format('uuid'))
    .required()
    .prop('name', S.string())
    .required()
    .prop('image', S.string())
    .required()
    .prop(
      'env',
      S.array().items(
        S.object()
          .additionalProperties(false)
          .prop('name', S.string())
          .required()
          .prop('value', S.string())
          .prop('secretKey', S.string()),
      ),
    )
    .prop('secretName', S.string())
    .prop('createdAt', S.string().format('date-time'))
    .required()
    .prop('updatedAt', S.string().format('date-time'))
    .required()
}
