import type { CouchDocument, CouchStore } from '@brer/types'
import S, { JSONSchema } from 'fluent-json-schema-es'

import { getSignature } from './token.js'
import { tail } from './util.js'

export interface PaginationToken<
  F extends object = Record<string, any>,
  S extends string = string,
> {
  direction: 'asc' | 'desc'
  filter: F
  sort: S
  value: boolean | number | string
}

export function encodeContinueToken(options: PaginationToken): string {
  const payload = Buffer.from(JSON.stringify(options), 'utf-8')
  const signature = getSignature(payload)
  return `${payload.toString('base64')}.${signature.toString('base64')}`
}

export function decodeContinueToken(token: string): PaginationToken | null {
  const [payload, signature] = token
    .split('.')
    .slice(0, 2)
    .map(item => Buffer.from(item, 'base64'))

  console.log(token)

  if (payload && signature && getSignature(payload).compare(signature) === 0) {
    return JSON.parse(payload.toString('utf-8'))
  }
  return null
}

export interface PaginationQuerystring {
  /**
   * @default "asc"
   */
  direction?: 'asc' | 'desc'
  continue?: string
  /**
   * @default "25"
   */
  limit?: number
  /**
   * @default "createdAt"
   */
  sort?: string
}

export async function getPage<
  T extends CouchDocument,
  Q extends PaginationQuerystring,
>(
  store: CouchStore<T>,
  querystring: Q,
  getFilter: (querystring: Q) => object,
  getSort: (
    sort: string,
    direction: 'asc' | 'desc',
  ) => Array<Record<string, 'asc' | 'desc'>>,
  getCursorFilter: (token: PaginationToken) => object,
  getCursorValue: (doc: T, sort: string) => boolean | number | string,
) {
  const oldToken = querystring.continue
    ? decodeContinueToken(querystring.continue)
    : null

  if (querystring.continue && !oldToken) {
    return null
  }

  const direction = oldToken?.direction || querystring.direction || 'asc'
  const sort = oldToken?.sort || querystring.sort || 'createdAt'

  let filter = oldToken ? oldToken.filter : getFilter(querystring)
  if (oldToken) {
    const obj = getCursorFilter(oldToken)

    if (Object.keys(filter).length) {
      // An empty filter ("{}") inside an "$and" will not match anything (why?!)
      filter = { $and: [filter, obj] }
    } else {
      filter = obj
    }
  }

  const documents = await store.filter(filter).unwrap({
    limit: querystring.limit || 25,
    sort: getSort(sort, direction),
  })

  const lastDoc = tail(documents)
  const newToken: string | undefined = lastDoc
    ? encodeContinueToken({
        filter: oldToken?.filter ?? filter,
        sort,
        value: getCursorValue(lastDoc, sort),
        direction,
      })
    : undefined

  return {
    continueToken: newToken,
    documents,
  }
}

export function getPageSchema(propName: string, schema: JSONSchema) {
  return S.object()
    .additionalProperties(false)
    .prop(propName, S.array().items(schema))
    .description('Page documents.')
    .required()
    .prop('continue', S.string())
    .description(
      'You can use this token in querystring to retrieve the next page.',
    )
}
