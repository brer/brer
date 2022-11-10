import { Invocation, InvocationStatus } from './types.js'

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

export function reserveInvocation(invocation: Invocation): Invocation {
  if (invocation.status !== InvocationStatus.Pending) {
    throw new Error()
  }
  return pushInvocationStatus(invocation, InvocationStatus.Initializing)
}

export function runInvocation(invocation: Invocation): Invocation {
  if (invocation.status !== InvocationStatus.Initializing) {
    throw new Error()
  }
  return pushInvocationStatus(invocation, InvocationStatus.Running)
}
