import type { CouchDocument } from '../lib/adapter.js'

export interface InvocationLog extends CouchDocument {
  /**
   * Logs are uploaded up to this date (ms from unix time epoch).
   */
  date: number
  /**
   * Log pages.
   */
  pages: InvocationLogPage[]
  /**
   * Source pod name.
   */
  pod: string
}

export interface InvocationLogPage {
  /**
   * Referenced attachment name.
   */
  attachment: string
  /**
   * Number of milliseconds since the UNIX epoch.
   */
  date: number
  /**
   * Last found (parsed) line inside this page.
   */
  lastLine: InvocationLogLine
}

export interface InvocationLogLine {
  /**
   * Number of milliseconds since the UNIX epoch.
   */
  date: number
  /**
   * Raw RFC3339 or RFC3339Nano timestamp.
   */
  timestamp: string
  /**
   * Line's value (raw text).
   */
  value: string
}
