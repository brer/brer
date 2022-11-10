import { default as got, Got } from 'got'
import { Adapter, Generics, Store } from 'mutent'

export interface CouchDocument {
  /**
   * Document identifier.
   */
  _id?: string
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
  _v?: number
  /**
   * ISO date string.
   */
  createdAt?: string
  /**
   * ISO date string.
   */
  updatedAt?: string
}

/**
 * Mango query object or string identifier.
 */
export type CouchQuery = string | Record<string, any>

export interface CouchOptions {
  fields?: string[]
  sort?: string[] | Array<Record<string, 'asc' | 'desc'>>
  limit?: number
  skip?: number
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
   * CouchDB server URL.
   *
   * @default "http://127.0.0.1:5984/"
   */
  url?: string
  username?: string
  password?: string
}

export class CouchAdapter<T extends CouchDocument>
  implements Adapter<{ entity: T; options: CouchOptions; query: CouchQuery }>
{
  readonly database: string

  readonly got: Got

  constructor({ database, password, url, username }: CouchAdapterOptions) {
    this.database = database

    this.got = got.extend({
      prefixUrl: url || 'http://127.0.0.1:5984/',
      username,
      password,
    })
  }

  /**
   * Read document by identifier.
   */
  async read(id: string, options?: CouchOptions): Promise<T | null> {
    const response = await this.got<T>({
      method: 'GET',
      url: `${this.database}/${id}`,
      throwHttpErrors: false,
    })
    if (response.statusCode === 200) {
      return response.body
    } else if (response.statusCode === 404) {
      return null
    } else {
      // TODO
      throw new Error()
    }
  }

  /**
   * Create or update a document.
   * Set `_deleted: true` to delete a document.
   */
  async write(document: T, options?: CouchOptions): Promise<T> {
    if (options?.fields?.length) {
      // TODO
      throw new Error()
    }
    const response = await this.got<{ id: string; rev: string }>({
      method: document._id ? 'PUT' : 'POST',
      url: document._id ? `${this.database}/${document._id}` : this.database,
      json: document,
      throwHttpErrors: false,
    })
    if (response.statusCode !== 201) {
      // TODO
      throw new Error()
    }
    return {
      ...document,
      _id: response.body.id,
      _rev: response.body.rev,
    }
  }

  async find(query: CouchQuery, options: CouchOptions): Promise<T | null> {
    for await (const item of this.filter(query, { ...options, limit: 1 })) {
      return item
    }
    return null
  }

  async *filter(query: CouchQuery, options: CouchOptions): AsyncIterable<T> {
    if (typeof query === 'string') {
      const document = await this.read(query, options)
      if (document !== null) {
        yield document
      }
      return
    }

    // TODO: stream
    const response = await this.got<{ docs: T[] }>({
      method: 'POST',
      url: `${this.database}/_find`,
      json: {
        ...options,
        selector: query,
      },
      responseType: 'json',
    })
    for (const document of response.body.docs) {
      yield document
    }
  }

  async create(data: T, options: CouchOptions) {
    return this.write(data, options)
  }

  async update(oldData: T, newData: T, options: CouchOptions) {
    return this.write(newData, options)
  }

  async delete(data: T, options: CouchOptions) {
    return this.update(data, { ...data, _deleted: true }, options)
  }
}
