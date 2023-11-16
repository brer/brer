import type { CouchDocument } from '../lib/adapter.js'

export interface Project extends CouchDocument {
  /**
   *
   */
  name: string
  /**
   * TODO: use this namespace
   */
  namespace: string
  /**
   * Key is username.
   * Value is array of rules.
   */
  roles: Record<string, ProjectRole>
}

// - `publisher`: read and write registry
// - `viewer`: read only api
// - `invoker`: read api and invoke
// - `admin`: everything
export type ProjectRole = 'publisher' | 'viewer' | 'invoker' | 'admin'
