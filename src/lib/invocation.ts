import type { Invocation, InvocationLog, InvocationStatus } from '@brer/types'
import { createHash } from 'node:crypto'

import { isOlderThan } from './util.js'

function pushInvocationStatus(
  invocation: Invocation,
  status: InvocationStatus,
): Invocation {
  return {
    ...invocation,
    status,
    phases: [
      ...invocation.phases,
      {
        date: new Date().toISOString(),
        status,
      },
    ],
  }
}

/**
 * Move Invocation from "pending" to "initializing" status.
 */
export function handleInvocation(invocation: Invocation): Invocation {
  if (invocation.status !== 'pending') {
    throw new Error()
  }
  return pushInvocationStatus(invocation, 'initializing')
}

/**
 * Move Invocation from "initializing" to "running" status.
 */
export function runInvocation(invocation: Invocation): Invocation {
  if (invocation.status !== 'initializing') {
    throw new Error()
  }
  return pushInvocationStatus(invocation, 'running')
}

/**
 * Move Invocation from "running" to "completed" status.
 */
export function completeInvocation(
  invocation: Invocation,
  result: any = null,
): Invocation {
  if (invocation.status !== 'running') {
    throw new Error()
  }
  return pushInvocationStatus({ ...invocation, result }, 'completed')
}

/**
 * Move Invocation from any other status to "failed" status.
 */
export function failInvocation(
  invocation: Invocation,
  reason: any = 'unknown error',
): Invocation {
  switch (invocation.status) {
    case 'failed':
      return invocation
    case 'initializing':
    case 'pending':
    case 'running':
      return pushInvocationStatus({ ...invocation, reason }, 'failed')
    default:
      throw new Error(
        `Cannot fail Invocation ${invocation._id} (status is ${invocation.status})`,
      )
  }
}

/**
 * Get initialization date.
 */
export function getInitializingDate(invocation: Invocation): Date | null {
  const timestamp = invocation.phases.find(
    phase => phase.status === 'initializing',
  )?.date
  return timestamp ? new Date(timestamp) : null
}

/**
 * invocation has reached "init timeout"
 */
export function hasTimedOut(invocation: Invocation): boolean {
  if (invocation.status === 'initializing') {
    const phase = invocation.phases.find(item => item.status === 'initializing')
    if (phase) {
      // TODO: should be a env var
      return isOlderThan(phase.date, 600) // 10 minutes (seconds)
    }
  }
  return false
}

export function pushLines(doc: Invocation, buffer: Buffer): Invocation {
  const digest = getDigest(buffer)

  if (doc._attachments) {
    for (const attachment of Object.values(doc._attachments)) {
      if (attachment.digest === digest) {
        // This log chunk was already uploaded before (no changes)
        return doc
      }
    }
  }

  const index = (doc.logs?.length || 0).toString().padStart(2, '0')
  const now = new Date()

  const log: InvocationLog = {
    attachment: `page_${index}.txt`,
    date: now.toISOString(),
  }

  return {
    ...doc,
    _attachments: {
      ...doc._attachments,
      [log.attachment]: {
        content_type: 'text/plain; charset=utf-8',
        data: buffer.toString('base64'),
      },
    },
    logs: [...(doc.logs || []), log],
    updatedAt: now.toISOString(),
  }
}

function getDigest(buffer: Buffer): string {
  return `md5-${createHash('md5').update(buffer).digest('base64')}`
}
