import type { CouchDocument } from '../lib/adapter.js'

export interface User extends CouchDocument {
  /**
   *
   */
  username: string
  /**
   * Hashed password.
   */
  hashedPassword: string
}
