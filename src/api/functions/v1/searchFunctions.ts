import type { RouteOptions } from '@brer/fastify'
import type { Fn } from '@brer/function'
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
    sort?: 'createdAt' | 'name'
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
      .prop('limit', S.integer().minimum(1).maximum(100).default(25))
      .prop(
        'sort',
        S.string().enum(['createdAt', 'name']).default('createdAt'),
      ),
    response: {
      200: getPageSchema(
        'functions',
        S.ref('https://brer.io/schema/v1/function.json'),
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
      database.functions,
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
      functions: page.documents,
    }
  },
})

function getFilter(querystring: RouteGeneric['Querystring']) {
  return {}
}

function getSort(sort: string, direction: 'asc' | 'desc') {
  switch (sort) {
    case 'name':
      return [{ name: direction }]
    default:
      return [{ createdAt: direction }]
  }
}

function getCursorFilter(token: PaginationToken) {
  const operator = token.direction === 'desc' ? '$lt' : '$gt'
  switch (token.sort) {
    case 'name':
      return { name: { [operator]: token.value } }
    default:
      return { createdAt: { [operator]: token.value } }
  }
}

function getCursorValue(doc: Fn, sort: unknown) {
  switch (sort) {
    case 'name':
      return doc.name
    default:
      return doc.createdAt!
  }
}
