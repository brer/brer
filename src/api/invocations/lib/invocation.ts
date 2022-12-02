import type { FnEnv, Invocation, InvocationStatus } from '@brer/types'
import * as uuid from 'uuid'

export interface CreateInvocationOptions {
  env?: FnEnv[]
  functionName: string
  image: string
}

export function createInvocation({
  env = [],
  functionName,
  image,
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

export interface PatchInvocationOptions {
  status?: InvocationStatus
  result?: any
  reason?: any
}

/**
 * This function just update the status.
 */
export function patchInvocation(
  invocation: Invocation,
  options: PatchInvocationOptions,
): Invocation {
  if (!options.status || options.status === invocation.status) {
    // Nothing to do
    return invocation
  }
  switch (options.status) {
    case 'completed':
      return completeInvocation(invocation, options.result)
    case 'failed':
      return failInvocation(invocation, options.reason)
    case 'pending':
      return handleInvocation(invocation)
    case 'running':
      return runInvocation(invocation)
    default:
      return invocation
  }
}
