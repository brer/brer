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
   * Name of the secret from which this function will load.
   * Defaults to `"fn-{function-name}"`.
   */
  secretName?: string
}

export interface FnEnv {
  name: string
  value?: string
  secretKey?: string
}
