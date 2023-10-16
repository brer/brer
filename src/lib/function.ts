import type { Fn, FnRuntime, Invocation } from '@brer/types'
import * as uuid from 'uuid'

import { isPlainObject } from './util.js'

const namespace =
  process.env.UUID_NAMESPACE || 'f71b108f-2005-4269-be6f-e83005040874'

export function getFunctionSecretName(functionName: string) {
  return `fn-${functionName}`
}

export function getFunctionId(functionName: string) {
  return uuid.v5(functionName, namespace)
}

export function updateFunction(fn: Fn, options: Pick<Fn, 'env' | 'image'>): Fn {
  if (fn.image === options.image) {
    return { ...fn, env: options.env }
  }
  return {
    ...fn,
    env: options.env,
    image: options.image,
    runtime: undefined,
  }
}

export function setFunctionRuntime(fn: Fn, invocation: Invocation): Fn {
  if (fn.image !== invocation.image) {
    throw new Error(
      `Invocation ${invocation._id} doesn't represent ${fn.name} runtime`,
    )
  }
  if (invocation.status === 'failed') {
    return {
      ...fn,
      runtime: {
        type: 'Failure',
        reason: invocation.reason,
      },
    }
  }
  if (invocation.status !== 'completed') {
    throw new Error('Invalid Invocation status')
  }
  return {
    ...fn,
    runtime: getFunctionRuntime(invocation.result),
  }
}

function getFunctionRuntime(result: unknown): FnRuntime {
  if (isPlainObject(result) && typeof result.type === 'string') {
    return result as FnRuntime
  } else {
    return {
      type: 'Unknown',
      result,
    }
  }
}
