import type {
  Invocation,
  InvocationLog,
  InvocationStatus,
} from '@brer/invocation'

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
    throw new Error('Invocation must be pending to init')
  }
  return pushInvocationStatus(invocation, 'initializing')
}

/**
 * Move Invocation from "initializing" to "running" status.
 */
export function runInvocation(invocation: Invocation): Invocation {
  if (invocation.status !== 'initializing') {
    throw new Error('Invocation must be initializing to run')
  }
  return pushInvocationStatus(invocation, 'running')
}

export function progressInvocation(
  invocation: Invocation,
  result: unknown = null,
): Invocation {
  if (invocation.status !== 'running') {
    throw new Error('Invocation must be running to progress')
  }

  const phases = invocation.phases.filter(p => p.status !== 'progress')
  return {
    ...invocation,
    result,
    phases: [
      ...phases,
      {
        date: new Date().toISOString(),
        status: 'progress',
      },
    ],
  }
}

/**
 * Move Invocation from "running" to "completed" status.
 */
export function completeInvocation(
  invocation: Invocation,
  result: unknown = null,
): Invocation {
  if (invocation.status !== 'running') {
    throw new Error('Invocation must be running to complete')
  }
  return pushInvocationStatus({ ...invocation, result }, 'completed')
}

/**
 * Move Invocation from any other status to "failed" status.
 */
export function failInvocation(
  invocation: Invocation,
  reason: unknown = 'unknown error',
): Invocation {
  switch (invocation.status) {
    case 'failed':
      return invocation
    case 'initializing':
    case 'pending':
    case 'running':
      return pushInvocationStatus(
        {
          ...invocation,
          reason,
          result: undefined, // clean last progress update
        },
        'failed',
      )
    default:
      throw new Error(
        `Cannot fail Invocation ${invocation._id} (status is ${invocation.status})`,
      )
  }
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

export function putLogPage(
  doc: Invocation,
  buffer: Buffer,
  index: number,
): Invocation {
  const now = new Date()

  // actual attachment name to use (default to this value, or retrived from previous value)
  let attachment = `page_${index}.txt`

  const logs: InvocationLog[] = []
  if (doc.logs) {
    for (const obj of doc.logs) {
      if (obj.index === index) {
        attachment = obj.attachment
      } else {
        logs.push(obj)
      }
    }
  }
  logs.push({
    attachment,
    date: now.toISOString(),
    index,
  })
  logs.sort((a, b) => a.index - b.index)

  return {
    ...doc,
    _attachments: {
      ...doc._attachments,
      [attachment]: {
        content_type: 'text/plain; charset=utf-8',
        data: buffer.toString('base64'),
      },
    },
    logs,
    updatedAt: now.toISOString(),
  }
}

export function setTokenId(
  invocation: Invocation,
  tokenId: string,
): Invocation {
  if (invocation.status !== 'initializing') {
    throw new Error(`Expected Invocation ${invocation._id} to be initializing`)
  }
  return {
    ...invocation,
    tokenId,
  }
}
