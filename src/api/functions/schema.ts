import type { FastifyInstance } from '@brer/fastify'
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
    .prop('project', S.string())
    .required()
    .prop(
      'image',
      S.object()
        .additionalProperties(false)
        .prop('host', S.string())
        .required()
        .prop('name', S.string())
        .required()
        .prop('tag', S.string())
        .required(),
    )
    .required()
    .prop(
      'env',
      S.array().items(
        S.object()
          .additionalProperties(false)
          .prop('name', S.string())
          .required()
          .prop('value', S.string())
          .prop('secretName', S.string())
          .prop('secretKey', S.string()),
      ),
    )
    .prop(
      'runtime',
      S.object()
        .additionalProperties(true)
        .prop('type', S.string())
        .description(
          'Runtime type idenfitier. Special cases are `"Unknown"` and `"Failure"`.',
        )
        .required()
        .prop('result')
        .description('Invocation result when the runtime cannot be determined.')
        .prop('reason')
        .description('Invocation failure reason.'),
    )
    .prop('historyLimit', S.integer())
    .prop('createdAt', S.string().format('date-time'))
    .required()
    .prop('updatedAt', S.string().format('date-time'))
    .required()
}
