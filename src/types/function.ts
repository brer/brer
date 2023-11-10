import type { CouchDocument } from '../lib/adapter.js'
import type { ContainerImage } from '../lib/image.js'

export interface Fn extends CouchDocument {
  /**
   * The name of this function (param case).
   */
  name: string
  /**
   * Container image location.
   */
  image: ContainerImage
  /**
   * Environment variables (value or secret).
   */
  env: FnEnv[]
  /**
   * Field present after the first test run.
   */
  runtime?: FnRuntime
  /**
   * Security group/scope.
   */
  group: string
  /**
   * @default 10
   */
  historyLimit?: number
  /**
   * Toggle distribution registry access.
   */
  exposeRegistry?: boolean
}

export interface FnRuntime {
  /**
   * Runtime type identifier.
   *
   * @example "Failure"
   * @example "Go"
   * @example "Node.js"
   * @example "Rust"
   */
  type: string
  /**
   * Other runtime-specific fields.
   */
  [key: string]: any
}

export interface FnEnv {
  name: string
  value?: string
  secretName?: string
  secretKey?: string
}
