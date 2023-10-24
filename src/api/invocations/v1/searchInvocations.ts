import type { RouteOptions } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import S from 'fluent-json-schema-es'

import {
  PaginationQuerystring,
  PaginationToken,
  getPage,
  getPageSchema,
} from '../../../lib/pagination.js'
import { asInteger } from '../../../lib/qs.js'

interface RouteGeneric {
  Querystring: PaginationQuerystring & {
    functionName?: string
    sort?: 'createdAt'
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/invocations',
  schema: {
    tags: ['invocation'],
    querystring: S.object()
      .additionalProperties(false)
      .prop('functionName', S.string().pattern(/^[a-z][0-9a-z\-]+[0-9a-z]$/))
      .prop('continue', S.string())
      .prop('direction', S.string().enum(['asc', 'desc']).default('asc'))
      .prop('limit', S.integer().minimum(1).maximum(100).default(25))
      .prop('sort', S.string().enum(['createdAt']).default('createdAt')),
    response: {
      200: getPageSchema(
        'invocations',
        S.ref('https://brer.io/schema/v1/invocation.json'),
      ),
    },
  },
  async preValidation(request) {
    request.query.limit = asInteger(request.query.limit)
  },
  async handler(request, reply) {
    const { database } = this
    const { query } = request

    const page = await getPage(
      database.invocations,
      query,
      getFilter,
      getSort,
      getCursorFilter,
      getCursorValue,
    )
    if (!page) {
      return reply.code(400).error({ message: 'Invalid continue token.' })
    }

    return {
      continue: page.continueToken,
      invocations: page.documents,
    }
  },
})

function getFilter(querystring: RouteGeneric['Querystring']) {
  const filter: Record<string, any> = {}
  if (querystring.functionName) {
    filter.functionName = querystring.functionName
  }
  return filter
}

function getSort(sort: string, direction: 'asc' | 'desc') {
  switch (sort) {
    default:
      return [{ createdAt: direction }]
  }
}

function getCursorFilter(token: PaginationToken) {
  const operator = token.direction === 'desc' ? '$lt' : '$gt'
  switch (token.sort) {
    default:
      return { createdAt: { [operator]: token.value } }
  }
}

function getCursorValue(doc: Invocation, sort: unknown) {
  switch (sort) {
    default:
      return doc.createdAt!
  }
}
