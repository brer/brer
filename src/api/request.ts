import type { FastifyInstance } from '@brer/fastify'
import type { Fn, FnEnv } from '@brer/function'

import { AsyncRequestResult } from '../lib/error.js'
import { getFunctionSecretName } from '../lib/function.js'
import * as Result from '../lib/result.js'
import { type Token } from '../lib/token.js'

export interface InvokeOptions {
  /**
   * Override some envs.
   */
  env?: Record<string, string>
  /**
   * Optional Invocation payload.
   */
  payload?: Buffer
  /**
   * Payload's content type.
   */
  contentType?: string
  /**
   * Execute "runtime test" mode.
   */
  runtimeTest?: boolean
}

export async function invoke(
  { pools, store }: FastifyInstance,
  token: Token,
  fn: Fn,
  options: InvokeOptions = {},
): AsyncRequestResult {
  const response = await pools.get('invoker').request({
    method: 'POST',
    path: '/invoker/v1/invocations',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      env: mergeEnv(fn, options.env),
      runtimeTest: options.runtimeTest,
      image: fn.image,
      functionName: fn.name,
      project: fn.project,
      payload: options.payload?.toString('base64'),
      contentType: options?.contentType,
    }),
  })

  const body: any = await response.body.json()
  if (response.statusCode === 201) {
    await rotateInvocations(store, fn)
    return Result.ok(body.invocation)
  } else {
    return Result.err({ ...body.error, status: response.statusCode })
  }
}

function mergeEnv(fn: Fn, record: Record<string, string> = {}) {
  const keys = Object.keys(record)
  const secret = getFunctionSecretName(fn.name)

  const env: FnEnv[] = keys
    .map(key => ({
      name: key,
      value: record[key],
    }))
    .filter(item => item.value.length > 0) // Empty strings will remove some envs

  for (const obj of fn.env) {
    if (!keys.includes(obj.name)) {
      if (obj.secretKey) {
        env.push({
          name: obj.name,
          secretName: obj.secretName || secret,
          secretKey: obj.secretKey,
        })
      } else {
        env.push({
          name: obj.name,
          value: obj.value,
        })
      }
    }
  }

  return env
}

async function rotateInvocations(store: FastifyInstance['store'], fn: Fn) {
  await store.invocations
    .filter({
      _design: 'default',
      _view: 'by_project',
      startkey: [fn.project, fn.name, {}],
      endkey: [fn.project, fn.name, null],
    })
    .delete()
    .consume({
      descending: true,
      purge: true,
      skip: fn.historyLimit || 10,
    })
}

export async function pushFunctionSecrets(
  { pools }: FastifyInstance,
  token: Token,
  functionName: string,
  secrets: Record<string, string>,
): AsyncRequestResult {
  if (!Object.keys(secrets).length) {
    return Result.ok(null)
  }

  const response = await pools.get('invoker').request({
    method: 'PUT',
    path: `/invoker/v1/secrets/${functionName}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(secrets),
  })

  if (response.statusCode === 204) {
    return Result.ok(null)
  } else {
    const data: any = await response.body.json()
    return Result.err({ ...data.error, status: response.statusCode })
  }
}

export async function pullFunctionSecrets(
  { pools }: FastifyInstance,
  token: Token,
  functionName: string,
): AsyncRequestResult {
  const response = await pools.get('invoker').request({
    method: 'DELETE',
    path: `/invoker/v1/secrets/${functionName}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: '{}',
  })

  if (response.statusCode === 204) {
    return Result.ok(null)
  } else {
    const data: any = await response.body.json()
    return Result.err({ ...data.error, status: response.statusCode })
  }
}

export async function deleteInvocation(
  { pools }: FastifyInstance,
  token: Token,
  invocationId: String,
): AsyncRequestResult {
  const response = await pools.get('invoker').request({
    method: 'DELETE',
    path: `/invoker/v1/invocations/${invocationId}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: '{}',
  })

  if (response.statusCode === 204 || response.statusCode === 404) {
    return Result.ok(null)
  } else {
    const body: any = await response.body.json()
    return Result.err({ ...body.error, status: response.statusCode })
  }
}

export async function stopInvocation(
  { pools }: FastifyInstance,
  token: Token,
  invocationId: String,
): AsyncRequestResult {
  const response = await pools.get('invoker').request({
    method: 'PUT',
    path: `/invoker/v1/invocations/${invocationId}/status/failed`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      kill: true,
      reason: 'stopped manually',
    }),
  })

  const data: any = await response.body.json()
  if (response.statusCode === 200) {
    return Result.ok(data.invocation)
  } else if (response.statusCode === 404) {
    return Result.err({ status: 404 })
  } else {
    return Result.err({ ...data.error, status: response.statusCode })
  }
}
