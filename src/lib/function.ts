import { FastifyInstance } from '@brer/fastify'
import type { Fn, FnEnv } from '@brer/function'
import { v4 as uuid } from 'uuid'

import { isSameImage } from './image.js'
import { fixDuplicates, pickFirst } from './util.js'

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
  if (
    !isSameImage(fn.image, update.image) ||
    update.runtime?.type === 'Unknown'
  ) {
    update.runtime = undefined
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
