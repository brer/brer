import type { Fn, FnEnv, FnRuntime } from '@brer/function'
import type { Invocation } from '@brer/invocation'

import { isSameImage } from './image.js'
import { deriveUUID, isPlainObject } from './util.js'

export function getFunctionId(functionName: string) {
  return deriveUUID(`fn-${functionName}`)
}

export function getFunctionSecretName(functionName: string) {
  return `fn-${functionName}`
}

export function createFunction(
  options: Pick<
    Fn,
    'env' | 'exposeRegistry' | 'group' | 'historyLimit' | 'image' | 'name'
  >,
): Fn {
  return {
    _id: getFunctionId(options.name),
    env: options.env.map(stripSecretValue),
    exposeRegistry: options.exposeRegistry,
    group: options.group,
    historyLimit: options.historyLimit,
    image: options.image,
    name: options.name,
  }
}

export function updateFunction(
  fn: Fn,
  options: Pick<
    Fn,
    'exposeRegistry' | 'env' | 'group' | 'historyLimit' | 'image'
  >,
): Fn {
  const update: Fn = {
    ...fn,
    env: options.env.map(stripSecretValue),
    exposeRegistry: options.exposeRegistry,
    group: options.group,
    historyLimit: options.historyLimit,
    image: options.image,
  }

  // Changing an env can fix a "Pending" Pod
  if (fn.runtime?.type !== 'Failure' && isSameImage(fn.image, update.image)) {
    return update
  }

  return {
    ...update,
    runtime: undefined,
  }
}

function stripSecretValue(obj: FnEnv): FnEnv {
  if (obj.value && (obj.secretKey || obj.secretName)) {
    return { ...obj, value: undefined }
  } else {
    return obj
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
  if (
    isPlainObject(result) &&
    isPlainObject(result.runtime) &&
    typeof result.runtime.type === 'string'
  ) {
    return result.runtime as FnRuntime
  } else {
    return {
      type: 'Unknown',
      result,
    }
  }
}
