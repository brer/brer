import type { CouchDocument } from '../lib/adapter.js'

export interface Project extends CouchDocument {
  /**
   * Project's name.
   */
  name: string
  /**
   * Key is username.
   * Value is array of rules.
   */
  roles: Record<string, ProjectRole>
}

/**
 * - `publisher`: registry-only read and write
 * - `viewer`: api read-only
 * - `invoker`: api read and function invoke
 * - `admin`: everything
 */
export type ProjectRole = 'publisher' | 'viewer' | 'invoker' | 'admin'
