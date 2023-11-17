import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { asInteger } from '../../../lib/qs.js'

export interface RouteGeneric {
  Querystring: {
    direction?: 'asc' | 'desc'
    functionName?: string
    limit?: number
    project?: string
    skip?: number
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/invocations',
  schema: {
    tags: ['invocation'],
    querystring: S.object()
      .additionalProperties(false)
      .prop('direction', S.string().enum(['asc', 'desc']).default('asc'))
      .prop('functionName', S.string().pattern(/^[a-z][0-9a-z\-]+[0-9a-z]$/))
      .prop('limit', S.integer().minimum(1).maximum(100).default(25))
      .prop('project', S.string())
      .prop('skip', S.integer().minimum(0).default(0)),
    response: {
      200: S.object()
        .additionalProperties(false)
        .prop('count', S.integer().minimum(0))
        .required()
        .prop(
          'invocations',
          S.array().items(S.ref('https://brer.io/schema/v1/invocation.json')),
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
    const minKey = descending ? {} : null
    const maxKey = descending ? null : {}
    const response = await store.invocations.adapter.nano.view(
      'default',
      'by_project',
      {
        descending: query.direction === 'desc',
        startkey: [project, query.functionName || minKey, minKey],
        endkey: [project, query.functionName || maxKey, maxKey],
        include_docs: true,
        limit: query.limit || 25,
        skip: query.skip,
        sorted: true,
      },
    )

    return {
      count: response.total_rows,
      invocations: response.rows.map(row => row.doc),
    }
  },
})
