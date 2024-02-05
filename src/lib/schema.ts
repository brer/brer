import type { FastifyInstance } from '@brer/fastify'
import S from 'fluent-json-schema-es'

export function addSchema(fastify: FastifyInstance) {
  fastify.addSchema(v1Function())
  fastify.addSchema(v1Invocation())
  fastify.addSchema(v1Project())
}

function v1Function() {
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
    .prop('resources', resources())
    .description('Job resources configuration.')
    .prop('createdAt', S.string().format('date-time'))
    .required()
    .prop('updatedAt', S.string().format('date-time'))
    .required()
}

function v1Invocation() {
  return S.object()
    .additionalProperties(false)
    .id('https://brer.io/schema/v1/invocation.json')
    .prop('_id', S.string().format('uuid'))
    .description('Invocation unique identifier.')
    .required()
    .prop('project', S.string())
    .required()
    .prop('functionName', S.string())
    .description('The name of the Function that generated this Invocation.')
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
    .description('Container image URL info.')
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
    .prop('resources', resources())
    .description('Configured job resources.')
    .prop('result')
    .description('Progress or completition result value.')
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
    'progress',
  ])
}

function v1Project() {
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

function resources() {
  return S.object()
    .additionalProperties(false)
    .prop(
      'requests',
      S.object()
        .additionalProperties(false)
        .prop('cpu')
        .description('Follows Kubernetes notation.')
        .prop('memory')
        .description('Follows Kubernetes notation.'),
    )
    .description('Requested free resources before startup.')
    .prop(
      'limits',
      S.object()
        .additionalProperties(false)
        .prop('cpu')
        .description('Follows Kubernetes notation.')
        .prop('memory')
        .description('Follows Kubernetes notation.'),
    )
    .description('Resources upper limits.')
}
