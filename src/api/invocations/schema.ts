import { FastifyInstance } from 'fastify'
import { default as S } from 'fluent-json-schema'

export default function (fastify: FastifyInstance) {
  fastify.addSchema(v1Schema())
}

function v1Schema() {
  return S.object()
    .additionalProperties(false)
    .id('https://brer.io/schema/v1/invocation.json')
    .prop('_id', S.string().format('uuid'))
    .required()
    .prop('functionName', S.string())
    .required()
    .prop('status', S.string())
    .required()
    .prop('createdAt', S.string().format('date-time'))
    .required()
    .prop('updatedAt', S.string().format('date-time'))
    .required()
}
