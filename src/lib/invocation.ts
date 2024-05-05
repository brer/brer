import type {
  Invocation,
  InvocationLog,
  InvocationStatus,
} from '@brer/invocation'
import { randomBytes } from 'node:crypto'

function pushStatus(
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
 * From `pending` (or `failed`) to `initializing`.
 */
export function handleInvocation(invocation: Invocation): Invocation {
  if (invocation.status !== 'failed' && invocation.status !== 'pending') {
    throw new Error('Expected failed or pending Invocation')
  }

  let retries = invocation.retries || 0
  if (invocation.status === 'failed') {
    retries--
  }
  if (retries < 0) {
    throw new Error('Unexpected Invocation retry')
  }

  const suffix = invocation.suffix || randomBytes(4).toString('hex')

  const _attachments = { ...invocation._attachments }
  if (invocation.logs) {
    for (const log of invocation.logs) {
      delete _attachments[log.attachment]
    }
  }

  return pushStatus(
    {
      ...invocation,
      _attachments,
      logs: [],
      retries,
      suffix,
    },
    'initializing',
  )
}

/**
 * From `initializing` (or `failed`) to `running`.
 */
export function runInvocation(invocation: Invocation): Invocation {
  if (invocation.status !== 'initializing') {
    throw new Error('Expected initializing Invocation')
  }
  return pushStatus(invocation, 'running')
}

/**
 * Set a "partial result" during the `running` status.
 */
export function progressInvocation(
  invocation: Invocation,
  result: unknown = null,
): Invocation {
  if (invocation.status !== 'running') {
    throw new Error('Expected running Invocation')
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
    throw new Error('Expected running Invocation')
  }
  return pushStatus({ ...invocation, result }, 'completed')
}

/**
 * Move Invocation from any other status to "failed" status.
 */
export function failInvocation(
  invocation: Invocation,
  reason: unknown,
): Invocation {
  if (invocation.status === 'completed') {
    throw new Error('Unexpected Invocation status')
  }
  return {
    ...invocation,
    reason,
    result: undefined, // clean last progress update
  }
}

export function pushLogPage(
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
