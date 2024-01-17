import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getContinueToken, parseContinueToken } from '../../lib/pagination.js'
import { asInteger } from '../../lib/qs.js'

export interface RouteGeneric {
  Querystring: {
    continue?: string
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
      .prop('continue', S.string())
      .prop('direction', S.string().enum(['asc', 'desc']).default('asc'))
      .prop('project', S.string().default('default'))
      .prop('limit', S.integer().minimum(1).maximum(100).default(25))
      .prop('skip', S.integer().minimum(0).maximum(100).default(0)),
    response: {
      200: S.object()
        .additionalProperties(false)
        .prop(
          'functions',
          S.array().items(S.ref('https://brer.io/schema/v1/function.json')),
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

    const startkey = [project, token?.key ?? (descending ? {} : null)]
    const endkey = [project, descending ? null : {}]

    log.trace({ startkey, endkey, descending })
    const response = await store.functions.adapter.scope.view(
      'default',
      'by_project',
      {
        descending,
        include_docs: true,
        startkey,
        endkey,
        limit: limit + 1,
        skip: token ? undefined : query.skip,
        sorted: true,
        startkey_docid: token?.id,
      },
    )

    return {
      continue: getContinueToken(response.rows[limit], getSearchKey),
      functions: response.rows.slice(0, limit).map(row => row.doc),
    }
  },
})

function getSearchKey(key: any) {
  return key[1]
}
