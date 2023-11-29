import type { FastifyInstance } from '@brer/fastify'
import type { FnImage } from '@brer/function'
import Result from 'ultres'

import { type AsyncRequestResult } from '../lib/error.js'

/**
 * Resolve with the username.
 */
export async function authenticate(
  { pools }: FastifyInstance,
  authorization: string,
): AsyncRequestResult<string> {
  const response = await pools.get('api').request({
    method: 'GET',
    path: '/api/session',
    headers: {
      accept: 'application/json',
      authorization,
      'content-type': 'application/json; charset=utf-8',
    },
  })

  const data: any = await response.body.json()
  if (response.statusCode === 200) {
    if (data.authenticated === true) {
      return Result.ok(data.user.username)
    } else {
      return Result.err({ status: 401 })
    }
  } else {
    return Result.err({ ...data.error, status: response.statusCode })
  }
}

export async function getFunctionsList(
  { pools }: FastifyInstance,
  authorization: string,
): AsyncRequestResult<string[]> {
  const response = await pools.get('api').request({
    method: 'GET',
    path: '/api/v1/registry/functions',
    headers: {
      accept: 'application/json',
      authorization,
    },
  })

  const data: any = await response.body.json()
  if (response.statusCode === 200) {
    return Result.ok(data.functions)
  } else {
    return Result.err({ ...data.error, status: response.statusCode })
  }
}

export async function patchImageTag(
  { log, pools }: FastifyInstance,
  authorization: string,
  functionName: string,
  image: Required<FnImage>,
): Promise<void> {
  const response = await pools.get('api').request({
    method: 'PATCH',
    path: `/api/v1/functions/${functionName}`,
    headers: {
      accept: 'application/json',
      authorization,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      image,
    }),
  })

  const data = await response.body.json()
  if (response.statusCode === 200 || response.statusCode === 201) {
    log.debug({ functionName }, 'update function image tag')
  } else if (response.statusCode === 404) {
    log.warn({ functionName }, 'function not found')
  } else {
    log.error({ functionName, response: data }, 'image tag update failed')
  }
}
