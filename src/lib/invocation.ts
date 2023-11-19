import type { Fn, FnEnv } from '@brer/function'
import type {
  Invocation,
  InvocationLog,
  InvocationStatus,
} from '@brer/invocation'
import { type CouchDocumentAttachment } from 'mutent-couchdb'
import { createHash } from 'node:crypto'
import { v4 as uuid } from 'uuid'

import { getFunctionSecretName } from './function.js'
import { isOlderThan, tail } from './util.js'

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

export interface CreateInvocationOptions {
  contentType?: string
  env?: Record<string, string>
  fn: Fn
  payload?: Buffer
}

export function createInvocation(options: CreateInvocationOptions): Invocation {
  const now = new Date()
  const status = 'pending'

  const attachments: Record<string, CouchDocumentAttachment> = {}
  if (options.payload?.byteLength) {
    attachments.payload = {
      content_type: options.contentType || 'application/octet-stream',
      data: options.payload.toString('base64'),
    }
  }

  return {
    _id: uuid(),
    _attachments: attachments,
    status,
    phases: [
      {
        date: now.toISOString(),
        status,
      },
    ],
    env: getInvocationEnv(options),
    image: options.fn.image,
    functionName: options.fn.name,
    project: options.fn.project,
    createdAt: now.toISOString(),
  }
}

function getInvocationEnv(options: CreateInvocationOptions): FnEnv[] {
  const keys = Object.keys(options.env || {})
  const secret = getFunctionSecretName(options.fn.name)

  const envs: FnEnv[] = keys
    .map(key => ({
      name: key,
      value: options.env![key],
    }))
    .filter(item => item.value.length > 0) // Empty strings will remove some envs

  for (const env of options.fn.env) {
    if (!keys.includes(env.name)) {
      if (env.secretKey) {
        envs.push({
          name: env.name,
          secretName: env.secretName || secret,
          secretKey: env.secretKey,
        })
      } else {
        envs.push({
          name: env.name,
          value: env.value,
        })
      }
    }
  }

  return envs
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
  if (tail(doc.logs)?.digest === digest) {
    return doc
  }

  const index = (doc.logs?.length || 0).toString().padStart(2, '0')
  const now = new Date()

  const log: InvocationLog = {
    attachment: `page_${index}.txt`,
    date: now.toISOString(),
    digest,
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

/**
 * Today this is the same of CouchDB, but tomorrow CouchDB could update its
 * digest algorithm.
 */
function getDigest(buffer: Buffer): string {
  return 'md5-' + createHash('md5').update(buffer).digest('base64')
}

export function isTestRun(invocation: Invocation): boolean {
  return (
    invocation.env.find(item => item.name === 'BRER_MODE')?.value === 'test'
  )
}

export function setTokenSignature(
  invocation: Invocation,
  tokenSignature: string,
): Invocation {
  if (invocation.status !== 'initializing') {
    throw new Error(`Expected Invocation ${invocation._id} to be initializing`)
  }
  return {
    ...invocation,
    tokenSignature,
  }
}
