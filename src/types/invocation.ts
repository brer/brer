import type { BrerDocument } from './couchdb.js'
import type { FnEnv, FnImage, FnResources } from './function.js'

export interface Invocation extends BrerDocument {
  /**
   * Current status.
   * See `InvocationStatus` type for more info.
   */
  status: InvocationStatus
  /**
   * Completition result value.
   * Available when status is "completed".
   */
  result?: any
  /**
   * Failure reason.
   * Available when status is "failed".
   */
  reason?: any
  /**
   * List of past statuses.
   */
  phases: InvocationPhase[]
  /**
   * Source Function's name.
   */
  functionName: string
  image: InvocationImage
  /**
   * Test runs are flagged here.
   */
  env: FnEnv[]
  /**
   * Internal property. List of received log pages.
   */
  logs?: InvocationLog[]
  /**
   * Invocation's owner.
   */
  project: string
  /**
   *
   */
  runtimeTest?: boolean
  /**
   * Allowed resources.
   */
  resources?: FnResources
  /**
   * Number of retries after a failure.
   * This value will be decreased.
   *
   * @default 0
   */
  retries?: number
  /**
   * Random bytes (hex) suffixed to Pod's names.
   */
  suffix?: string
}

export type InvocationImage = FnImage

/**
 * Possible Invocation statuses.
 *
 * - `"pending"` The Invocation is queued to be started.
 * - `"initializing"` The Invocation code is running (waiting for ack).
 * - `"running"` The Invocation has started to process its task.
 * - `"completed"` The Invocation has completed its task successfully.
 * - `"failed"` The Invocation has failed its task.
 */
export type InvocationStatus =
  | 'pending'
  | 'initializing'
  | 'running'
  | 'completed'
  | 'failed'

export interface InvocationPhase {
  /**
   * Phase status.
   */
  status: InvocationStatus | 'progress'
  /**
   * ISO 8601 date string.
   */
  date: string
}

export interface InvocationLog {
  /**
   * Attachment's name.
   */
  attachment: string
  /**
   * Date of log acquisition. ISO 8601 date string.
   */
  date: string
  /**
   * Page log ordering index.
   */
  index: number
}
