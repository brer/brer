import type { FnEnv, Invocation, InvocationStatus } from '@brer/types'
import * as uuid from 'uuid'

export interface CreateInvocationOptions {
  env?: FnEnv[]
  functionName: string
  image: string
  payload: {
    contentType?: string
    data: Buffer
  }
}

export function createInvocation({
  env = [],
  functionName,
  image,
  payload,
}: CreateInvocationOptions): Invocation {
  const date = new Date().toISOString()
  const status = 'pending'
  return {
    _id: uuid.v4(),
    status,
    phases: [{ date, status }],
    env,
    image,
    functionName,
    createdAt: date,
    _attachments: {
      payload: {
        content_type: payload.contentType || 'application/octet-stream',
        data: payload.data.toString('base64'),
      },
    },
  }
}

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
  if (invocation.status === 'failed') {
    throw new Error()
  }
  return pushInvocationStatus({ ...invocation, reason }, 'failed')
}
