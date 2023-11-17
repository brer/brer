import type { FastifyInstance } from '@brer/fastify'
import S from 'fluent-json-schema-es'

export default function (fastify: FastifyInstance) {
  fastify.addSchema(v1Schema())
}

function v1Schema() {
  return S.object()
    .additionalProperties(false)
    .id('https://brer.io/schema/v1/project.json')
    .prop('_id', S.string().format('uuid'))
    .required()
    .prop('name', S.string())
    .required()
    .prop('roles', S.object().additionalProperties(S.string()))
    .required()
    .prop('createdAt', S.string().format('date-time'))
    .required()
    .prop('updatedAt', S.string().format('date-time'))
    .required()
}
