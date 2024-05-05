import type { ContainerImage } from '../lib/image.js'
import type { BrerDocument } from './couchdb.js'

export interface Fn extends BrerDocument {
  /**
   * The name of this function (param case).
   */
  name: string
  /**
   * Container image location.
   */
  image: FnImage
  /**
   * Environment variables (value or secret).
   */
  env: FnEnv[]
  /**
   * Field present after the first test run.
   */
  runtime?: FnRuntime
  /**
   * Invocation's owner.
   */
  project: string
  /**
   * Number of completed/failed Invocations to keep.
   *
   * @default 10
   */
  historyLimit?: number
  /**
   * Kubernetes resources configuration.
   */
  resources?: FnResources
  /**
   * When `true` the Function will allow only one active Invocation.
   */
  sequential?: boolean
}

export type FnImage = ContainerImage

export interface FnRuntime {
  /**
   * Runtime type identifier.
   *
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

export interface FnResources {
  requests?: {
    cpu?: string
    memory?: string
  }
  limits?: {
    cpu?: string
    memory?: string
  }
}
