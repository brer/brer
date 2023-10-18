import type { CouchDocument } from '../lib/adapter.js'

export interface Fn extends CouchDocument {
  /**
   * The name of this function (param case).
   */
  name: string
  /**
   * Docker image url.
   */
  image: string
  /**
   * Environment variables (value or secret).
   */
  env: FnEnv[]
  /**
   * Field present after the first test run.
   */
  runtime?: FnRuntime
}

export interface FnRuntime {
  /**
   * Runtime type identifier.
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
