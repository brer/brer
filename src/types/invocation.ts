import type { ContainerImage } from '../lib/image.js'
import type { BrerDocument } from './document.js'
import type { FnEnv } from './function.js'

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
  phases: InvocationPhase[]
  /**
   * Source Function's name.
   */
  functionName: string
  image: ContainerImage
  /**
   * Test runs are flagged here.
   */
  env: FnEnv[]
  /**
   * Current token signature.
   */
  tokenSignature?: string
  /**
   * Internal property. List of received log pages.
   */
  logs?: InvocationLog[]
  /**
   * Invocation's owner.
   */
  project: string
}

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
  /**
   * Progress update data.
   */
  result?: any
}

export interface InvocationLog {
  /**
   * Attachment's name.
   */
  attachment: string
  /**
   * Date of arrival. ISO 8601 date string.
   */
  date: string
  /**
   * MD5 digest.
   */
  digest: string
}
