import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { asInteger } from '../../../lib/qs.js'

export interface RouteGeneric {
  Querystring: {
    direction?: 'asc' | 'desc'
    group?: string
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
      .prop('group', S.string())
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
    const { gateway, store } = this
    const { query, session } = request

    const groupsResult = await gateway.authorize(
      session.username,
      'api_read',
      query.group ? [query.group] : null,
    )
    if (groupsResult.isErr) {
      return reply.code(403).error(groupsResult.unwrapErr())
    }

    const groups = groupsResult.unwrap()

    const response = await store.functions.adapter.nano.view(
      'default',
      'by_group',
      {
        descending: query.direction === 'desc',
        include_docs: true,
        keys: groups?.map(group => [group]),
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
