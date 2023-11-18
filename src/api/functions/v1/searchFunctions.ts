import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { asInteger } from '../../../lib/qs.js'

export interface RouteGeneric {
  Querystring: {
    direction?: 'asc' | 'desc'
    project?: string
    limit?: number
    skip?: number
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/functions',
  schema: {
    tags: ['function'],
    querystring: S.object()
      .additionalProperties(false)
      .prop('direction', S.string().enum(['asc', 'desc']).default('asc'))
      .prop('project', S.string().default('default'))
      .prop('limit', S.integer().minimum(1).maximum(100).default(25))
      .prop('skip', S.integer().minimum(0)),
    response: {
      200: S.object()
        .additionalProperties(false)
        .prop('count', S.integer().minimum(0))
        .required()
        .prop(
          'functions',
          S.array().items(S.ref('https://brer.io/schema/v1/function.json')),
        )
        .required(),
    },
  },
  async preValidation(request) {
    request.query.limit = asInteger(request.query.limit)
    request.query.skip = asInteger(request.query.skip)
  },
  async handler(request, reply) {
    const { auth, store } = this
    const { query, session } = request

    const project = query.project || session.projects[0] || 'default'

    const result = await auth.authorize(session, 'viewer', project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    const descending = query.direction === 'desc'
    const response = await store.functions.adapter.scope.view(
      'default',
      'by_project',
      {
        descending,
        include_docs: true,
        startkey: [project, descending ? {} : null],
        endkey: [project, descending ? null : {}],
        limit: query.limit || 25,
        skip: query.skip,
        sorted: true,
      },
    )

    return {
      count: response.total_rows,
      functions: response.rows.map(row => row.doc),
    }
  },
})
