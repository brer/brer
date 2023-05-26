import type { FastifyInstance } from 'fastify'
import { default as S } from 'fluent-json-schema'

export default function (fastify: FastifyInstance) {
  fastify.addSchema(v1Schema())
}

function v1Schema() {
  return S.object()
    .additionalProperties(false)
    .id('https://brer.io/schema/v1/function.json')
    .prop('_id', S.string().format('uuid'))
    .required()
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
        .maxItems(100)
        .items(
          S.object()
            .additionalProperties(false)
            .prop(
              'name',
              S.string()
                .minLength(3)
                .maxLength(256)
                .pattern(/^[A-Za-z][0-9A-Za-z_\-]+$/),
            )
            .required()
            .prop('value', S.string().maxLength(4096))
            .required()
            .prop('secretKey', S.string()),
        ),
    )
    .prop('secretName', S.string())
    .prop('createdAt', S.string().format('date-time'))
    .readOnly()
    .required()
    .prop('updatedAt', S.string().format('date-time'))
    .readOnly()
    .required()
}
