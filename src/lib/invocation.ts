import type { Invocation, InvocationStatus } from '@brer/types'

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
export function handleInvocation(
  invocation: Invocation,
  signature: string,
): Invocation {
  if (invocation.status === 'initializing') {
    return {
      ...invocation,
      phases: invocation.phases.map(phase =>
        phase.status === 'initializing'
          ? {
              ...phase,
              date: new Date().toISOString(),
            }
          : phase,
      ),
      tokenSignature: signature,
    }
  }
  if (invocation.status !== 'pending') {
    throw new Error()
  }
  return pushInvocationStatus(
    { ...invocation, tokenSignature: signature },
    'initializing',
  )
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
  if (invocation.status === 'failed') {
    throw new Error()
  }
  return pushInvocationStatus({ ...invocation, reason }, 'failed')
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
