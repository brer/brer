import { FastifyInstance } from '@brer/fastify'
import type { Fn, FnEnv, FnRuntime } from '@brer/function'
import type { Invocation } from '@brer/invocation'
import { v4 as uuid } from 'uuid'

import { isSameImage } from './image.js'
import { fixDuplicates, isPlainObject, pickFirst } from './util.js'

export function getFunctionSecretName(functionName: string) {
  return `fn-${functionName}`
}

export function createFunction(fnName: string): Fn {
  return {
    _id: uuid(),
    draft: true,
    env: [],
    image: {
      host: '127.0.0.1:8080',
      name: fnName,
      tag: 'latest',
    },
    name: fnName,
    project: 'default',
  }
}

export function updateFunction(
  fn: Fn,
  options: Pick<Fn, 'env' | 'historyLimit' | 'image' | 'project'>,
): Fn {
  const update: Fn = {
    ...fn,
    env: options.env.map(stripSecretValue),
    historyLimit: options.historyLimit,
    image: options.image,
    project: options.project,
  }

  // Changing an env can fix a "Pending" Pod
  if (
    fn.runtime?.type !== 'Failure' &&
    isSameImage(fn.image, update.image) &&
    update.image.tag !== 'latest'
  ) {
    return update
  }

  return {
    ...update,
    runtime: undefined,
  }
}

/**
 * This function also fix duplicates.
 */
export async function getFunctionByName(
  store: FastifyInstance['store'],
  functionName: string,
  functionId?: string,
): Promise<Fn | null> {
  const fns = await store.functions
    .filter({
      _design: 'default',
      _view: 'by_name',
      startkey: [functionName, null],
      endkey: [functionName, {}],
    })
    .pipe(iterable => fixDuplicates(iterable, functionId))
    .commit()
    .filter(pickFirst)
    .unwrap()

  return fns.length ? fns[0] : null
}

function stripSecretValue(obj: FnEnv): FnEnv {
  if (obj.value && (obj.secretKey || obj.secretName)) {
    return { ...obj, value: undefined }
  } else {
    return obj
  }
}

export function setFunctionRuntime(fn: Fn, invocation: Invocation): Fn {
  if (!isSameImage(fn.image, invocation.image)) {
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
