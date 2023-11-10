import type { Adapter, Generics, Store } from 'mutent'
import nano from 'nano'

export interface CouchDocument {
  /**
   * Document identifier.
   * This is the only "unique" field, choose with care.
   */
  _id: string
  /**
   * Document revision identifier.
   */
  _rev?: string
  /**
   * Declares the deletion of the document.
   */
  _deleted?: boolean
  /**
   * Document version (database versioning).
   */
  v?: number
  /**
   * ISO date string.
   */
  createdAt?: string
  /**
   * ISO date string.
   */
  updatedAt?: string
  /**
   * Uploaded attachments.
   */
  _attachments?: Record<string, CouchDocumentAttachment>
}

export interface CouchDocumentAttachment {
  /**
   * Base-64 file content
   */
  data?: string
  content_type?: string
  revpos?: number
  digest?: string
  length?: number
  stub?: true
}

/**
 * Mango query object or string identifier.
 */
export type CouchQuery = string | Record<string, any>

export interface CouchViewQuery {
  _design: string
  _view: string
  startkey?: any
  endkey?: any
  key?: any
  keys?: any[]
}

export interface CouchOptions {
  fields?: string[]
  sort?: string[] | Array<Record<string, 'asc' | 'desc'>>
  limit?: number
  skip?: number
  /**
   * Perform a purge op instead an update.
   */
  purge?: boolean
  /**
   * Descending order while using views.
   */
  descending?: boolean
  /**
   * Toggle view results sorting.
   * @default true
   */
  sorted?: boolean
  /**
   *
   */
  inclusiveEnd?: boolean
}

export interface CouchGenerics<T extends CouchDocument> extends Generics {
  adapter: CouchAdapter<T>
  entity: T
  query: CouchQuery
  options: CouchOptions
}

export type CouchStore<T extends CouchDocument> = Store<CouchGenerics<T>>

export interface CouchAdapterOptions {
  /**
   * Database name.
   */
  database: string
  /**
   * Configured CouchDB client instance.
   */
  server: nano.ServerScope
}

export class CouchAdapter<T extends CouchDocument>
  implements Adapter<{ entity: T; options: CouchOptions; query: CouchQuery }>
{
  readonly database: string

  readonly nano: nano.DocumentScope<T>

  constructor({ database, server }: CouchAdapterOptions) {
    this.database = database
    this.nano = server.db.use(database)
  }

  // TODO: bulk

  /**
   * Read document by identifier.
   */
  async read(id: string, options?: CouchOptions): Promise<T | null> {
    let doc: T | null = null
    try {
      doc = await this.nano.get(id)
    } catch (err) {
      if (Object(err).statusCode !== 404) {
        return Promise.reject(err)
      }
    }
    return doc
  }

  /**
   * Create or update a document.
   * Set `_deleted: true` to delete a document.
   */
  async write(document: T, options?: CouchOptions): Promise<T> {
    const response = await this.nano.insert(document, {
      docName: document._id,
      rev: document._rev,
    })

    return {
      ...document,
      _id: response.id,
      _rev: response.rev,
    }
  }

  /**
   * Mutent method.
   */
  async find(query: CouchQuery, options: CouchOptions): Promise<T | null> {
    let result: T | null = null

    for await (const item of this.filter(query, {
      ...options,
      limit: 1,
    })) {
      if (result) {
        throw new Error('Unexpected iteration')
      } else {
        result = item
      }
    }

    return result
  }

  /**
   * Mutent method.
   */
  async *filter(query: CouchQuery, options: CouchOptions): AsyncIterable<T> {
    if (typeof query === 'string') {
      const doc = await this.read(query, options)
      if (doc) {
        yield doc
      }
    } else if (
      typeof query === 'object' &&
      typeof query._design === 'string' &&
      typeof query._view === 'string'
    ) {
      yield* this.filterView(query as CouchViewQuery, options)
    } else {
      yield* this.filterMango(query, options)
    }
  }

  async *filterView(
    query: CouchViewQuery,
    options: CouchOptions,
  ): AsyncIterable<T> {
    let skip = options.skip || 0
    const limit = (options.limit || Number.POSITIVE_INFINITY) + skip
    const size = 50

    while (skip < limit) {
      const page = Math.min(size, limit - skip)

      const response = await this.nano.view(query._design, query._view, {
        descending: options.descending,
        endkey: query.endkey,
        group: false,
        include_docs: true,
        inclusive_end: options.inclusiveEnd,
        key: query.key,
        keys: query.keys,
        limit: page,
        reduce: false,
        skip,
        sorted: options.sorted,
        startkey: query.startkey,
      })

      for (const row of response.rows) {
        skip++
        yield row.doc!
      }

      if (response.rows.length < page) {
        skip = limit
      }
    }
  }

  async *filterMango(
    query: Record<string, any>,
    options: CouchOptions,
  ): AsyncIterable<T> {
    const limit = options.limit || Number.POSITIVE_INFINITY
    const size = 50

    let bookmark: string | undefined
    let count = 0

    while (count < limit) {
      const page = Math.min(size, limit - count)

      const response = await this.nano.find({
        selector: query,
        bookmark,
        limit: page,
        fields: options.fields,
        skip: options.skip,
        sort: options.sort,
        // TODO: other options
      })
      if (response.warning) {
        console.error(this.database, query)
        console.error(response.warning)
      }

      for (const document of response.docs) {
        count++
        yield document
      }

      if (response.docs.length < page) {
        count = limit
      } else {
        bookmark = response.bookmark
      }
    }
  }

  /**
   * Mutent method.
   */
  async create(data: T, options: CouchOptions) {
    return this.write(data, options)
  }

  /**
   * Mutent method.
   */
  async update(oldData: T, newData: T, options: CouchOptions) {
    return this.write(newData, options)
  }

  /**
   * Mutent method.
   */
  async delete(data: T, options: CouchOptions) {
    // TODO: DELETE or _purge (option)
    if (options.purge) {
      //
    } else {
      //
    }

    await this.nano.server.request({
      db: this.database,
      path: '_purge',
      method: 'POST',
      body: {
        [data._id]: [data._rev],
      },
    })
  }
}
