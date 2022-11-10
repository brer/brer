import type { CouchDocument } from '../../../lib/store.js'
import type { FnEnv } from '../../functions/lib/types.js'

export interface Invocation extends CouchDocument {
  /**
   *
   */
  status: InvocationStatus
  /**
   *
   */
  phases: InvocationPhase[]
  /**
   *
   */
  functionName: string
  /**
   *
   */
  image: string
  /**
   *
   */
  env: FnEnv[]
  /**
   *
   */
  contentType: string
  /**
   * Bytes.
   */
  payloadSize: number
}

export enum InvocationStatus {
  Pending = 'pending',
  Initializing = 'initializing',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

export interface InvocationPhase {
  /**
   * Phase status.
   */
  status: InvocationStatus
  /**
   * ISO 8601 date string.
   */
  date: string
}
