import type { FastifyInstance } from '@brer/fastify'
import type { Fn, FnEnv } from '@brer/function'
import Result from 'ultres'

import type { ErrorOptions, RequestResult } from '../lib/error.js'
import { getFunctionSecretName } from '../lib/function.js'
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

/**
 * Creates a new Invocation and resolves with the created Invocation.
 * WARNING: The resulting Invocation is taken from the http response.
 */
export async function invoke(
  { pools }: FastifyInstance,
  token: Token,
  fn: Fn,
  options: InvokeOptions = {},
): Promise<RequestResult<{ _id: string }>> {
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
      resources: fn.resources,
    }),
  })

  const body: any = await response.body.json()
  if (response.statusCode === 201) {
    return Result.ok<{ _id: string }>(body.invocation)
  } else {
    return Result.err<ErrorOptions>({
      ...body.error,
      status: response.statusCode,
    })
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

export async function pushFunctionSecrets(
  { pools }: FastifyInstance,
  token: Token,
  functionName: string,
  secrets: Record<string, string>,
): Promise<RequestResult> {
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
    return Result.err<ErrorOptions>({
      ...data.error,
      status: response.statusCode,
    })
  }
}

export async function pullFunctionSecrets(
  { pools }: FastifyInstance,
  token: Token,
  functionName: string,
): Promise<RequestResult> {
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
    return Result.err<ErrorOptions>({
      ...data.error,
      status: response.statusCode,
    })
  }
}

export async function deleteInvocation(
  { log, pools }: FastifyInstance,
  token: Token,
  invocationId: String,
): Promise<RequestResult> {
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

  const body: any =
    response.statusCode === 204 ? null : await response.body.json()

  if (response.statusCode === 204 || response.statusCode === 404) {
    log.debug({ invocationId }, 'invocation deleted')
    return Result.ok()
  } else {
    return Result.err<ErrorOptions>({
      ...body.error,
      status: response.statusCode,
    })
  }
}

export async function stopInvocation(
  { pools }: FastifyInstance,
  token: Token,
  invocationId: String,
): Promise<RequestResult> {
  const response = await pools.get('invoker').request({
    method: 'PUT',
    path: `/invoker/v1/invocations/${invocationId}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      status: 'failed',
      reason: 'stopped manually',
    }),
  })

  const data: any = await response.body.json()
  if (response.statusCode === 200) {
    return Result.ok()
  } else if (response.statusCode === 404) {
    return Result.err({ status: 404 })
  } else {
    return Result.err<ErrorOptions>({
      ...data.error,
      status: response.statusCode,
    })
  }
}
