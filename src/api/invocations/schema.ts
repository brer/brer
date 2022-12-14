import type { FastifyInstance } from 'fastify'
import { default as S } from 'fluent-json-schema'

export default function (fastify: FastifyInstance) {
  fastify.addSchema(v1Schema())
}

function v1Schema() {
  return S.object()
    .additionalProperties(false)
    .id('https://brer.io/schema/v1/invocation.json')
    .prop('_id', S.string().format('uuid'))
    .description('Invocation unique identifier.')
    .required()
    .prop('functionName', S.string())
    .description('The name of the Function that generated this Invocation.')
    .required()
    .prop('status', status())
    .description('Current Invocation status.')
    .required()
    .prop(
      'phases',
      S.array().items(
        S.object()
          .additionalProperties(false)
          .prop('status', status())
          .required()
          .prop('date', S.string().format('date-time'))
          .required(),
      ),
    )
    .description('List of status change phases.')
    .required()
    .prop('result')
    .description('Completition result value.')
    .prop('reason')
    .description('Failure reason.')
    .prop('createdAt', S.string().format('date-time'))
    .required()
    .prop('updatedAt', S.string().format('date-time'))
    .required()
}

function status() {
  return S.string().enum([
    'pending',
    'initializing',
    'running',
    'completed',
    'failed',
  ])
}
