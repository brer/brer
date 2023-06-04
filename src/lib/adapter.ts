import { default as got, Got } from 'got'
import { Adapter, Generics, MutentError, Store } from 'mutent'

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
  _v?: number
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
      prefixUrl: new URL(this.database, url || 'http://127.0.0.1:5984/'),
      username,
      password,
      responseType: 'json',
      timeout: {
        request: 30000, // CouchDB should be fast :)
      },
    })
  }

  /**
   * Read document by identifier.
   */
  async read(id: string, options?: CouchOptions): Promise<T | null> {
    const response = await this.got<T>({
      method: 'GET',
      url: id,
      throwHttpErrors: false,
    })

    if (response.statusCode === 200) {
      return response.body
    } else if (response.statusCode === 404) {
      return null
    } else {
      throw new MutentError(
        'COUCHDB_READ_ERROR',
        Object(response.body).reason || 'Error while reading',
        {
          body: response.body,
          statusCode: response.statusCode,
        },
      )
    }
  }

  /**
   * Create or update a document.
   * Set `_deleted: true` to delete a document.
   */
  async write(document: T, options?: CouchOptions): Promise<T> {
    const response = await this.got<{ id: string; rev: string }>({
      method: document._id ? 'PUT' : 'POST',
      url: document._id || '.',
      json: document,
      throwHttpErrors: false,
      headers: {
        'if-match': document._rev,
      },
    })

    const attempts = document[Symbol.for('attempts')] || 0

    // TODO: Sometimes a 412 error is returnes, but the data is correct, just retry here, but I'm not sure if makes sense
    if (response.statusCode === 412) {
      if (attempts < 3) {
        document[Symbol.for('attempts')] = attempts + 1
        return this.write(document, options)
      }
    }

    if (response.statusCode !== 201 && response.statusCode !== 202) {
      throw new MutentError(
        'COUCHDB_WRITE_ERROR',
        Object(response.body).reason || 'Error while writing',
        {
          attempts,
          body: response.body,
          statusCode: response.statusCode,
        },
      )
    }

    return {
      ...document,
      _id: response.body.id,
      _rev: response.body.rev,
    }
  }

  async readAttachment(document: T, attachmentName: string) {
    const response = await this.got({
      method: 'GET',
      url: `${document._id}/${attachmentName}`,
      headers: {
        'if-match': document._rev,
      },
      responseType: 'buffer',
    })
    if (response.statusCode !== 200) {
      // TODO
      throw new Error()
    }
    return response.body
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
      url: '_find',
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
