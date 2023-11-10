import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { asInteger } from '../../../lib/qs.js'

export interface RouteGeneric {
  Querystring: {
    direction?: 'asc' | 'desc'
    functionName?: string
    group?: string
    limit?: number
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
      .prop('group', S.string())
      .prop('limit', S.integer().minimum(1).maximum(100).default(25))
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
    const { gateway, store } = this
    const { query, session } = request

    const result = await gateway.authorize(
      session.username,
      'api_read',
      query.group ? [query.group] : null,
    )
    if (result.isErr) {
      return reply.code(403).error(result.unwrapErr())
    }

    const groups = result.unwrap()

    const response = await store.invocations.adapter.nano.view(
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
      invocations: response.rows.map(row => row.doc),
    }
  },
})
