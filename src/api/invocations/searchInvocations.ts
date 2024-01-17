import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getContinueToken, parseContinueToken } from '../../lib/pagination.js'
import { asInteger } from '../../lib/qs.js'
import { API_ISSUER } from '../../lib/token.js'

export interface RouteGeneric {
  Querystring: {
    continue?: string
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
  config: {
    tokenIssuer: API_ISSUER,
  },
  schema: {
    tags: ['invocation'],
    querystring: S.object()
      .additionalProperties(false)
      .prop('continue', S.string())
      .prop('direction', S.string().enum(['asc', 'desc']).default('asc'))
      .prop('functionName', S.string().pattern(/^[a-z][0-9a-z\-]+[0-9a-z]$/))
      .prop('limit', S.integer().minimum(1).maximum(100).default(25))
      .prop('project', S.string())
      .prop('skip', S.integer().minimum(0).maximum(100).default(0)),
    response: {
      200: S.object()
        .additionalProperties(false)
        .prop(
          'invocations',
          S.array().items(S.ref('https://brer.io/schema/v1/invocation.json')),
        )
        .required()
        .prop('continue', S.string())
        .description(
          'You can use this token in querystring to retrieve the next page.',
        ),
    },
  },
  async preValidation(request) {
    request.query.limit = asInteger(request.query.limit)
    request.query.skip = asInteger(request.query.skip)
  },
  async handler(request, reply) {
    const { auth, store } = this
    const { log, query, session } = request

    const project = query.project || 'default'

    const result = await auth.authorize(session, 'viewer', project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    const limit = query.limit || 25
    const descending = query.direction === 'desc'
    const token = parseContinueToken(query.continue)

    const startkey = [
      project,
      token?.key[0] ?? query.functionName ?? (descending ? {} : null),
      token?.key[1] ?? (descending ? {} : null),
    ]
    const endkey = [
      project,
      token?.key[0] || query.functionName || (descending ? null : {}),
      descending ? null : {},
    ]

    log.trace({ startkey, endkey, descending })
    const response = await store.invocations.adapter.scope.view(
      'default',
      'by_project',
      {
        descending,
        startkey,
        endkey,
        include_docs: true,
        limit: limit + 1,
        skip: token ? undefined : query.skip,
        sorted: true,
        startkey_docid: token?.id,
      },
    )

    return {
      continue: getContinueToken(response.rows[limit], getSearchKey),
      invocations: response.rows.slice(0, limit).map(row => row.doc),
    }
  },
})

function getSearchKey(key: any) {
  return key.slice(1)
}
