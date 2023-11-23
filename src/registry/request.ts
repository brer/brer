import type { FastifyInstance } from '@brer/fastify'

import { type AsyncRequestResult } from '../lib/error.js'
import * as Result from '../lib/result.js'
import { type Token } from '../lib/token.js'

export async function authenticate(
  { pools }: FastifyInstance,
  username: string,
  password: string,
): AsyncRequestResult<true> {
  const token = Buffer.from(`${username}:${password}`).toString('base64')

  const response = await pools.get('api').request({
    method: 'GET',
    path: '/api/session',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
  })

  const data: any = await response.body.json()
  if (response.statusCode === 200) {
    if (data.authenticated === true) {
      return Result.ok(true)
    } else {
      return Result.err({ status: 401 })
    }
  } else {
    return Result.err({ ...data.error, status: response.statusCode })
  }
}

export async function patchImageTag(
  { log, pools }: FastifyInstance,
  token: Token,
  functionName: string,
  imageTag: string,
): Promise<void> {
  const response = await pools.get('api').request({
    method: 'PATCH',
    path: `/api/v1/functions/${functionName}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      image: {
        tag: imageTag,
      },
    }),
  })

  const data = await response.body.json()
  if (response.statusCode === 200) {
    log.debug({ functionName }, 'update function image tag')
  } else if (response.statusCode === 404) {
    log.warn({ functionName }, 'function not found')
  } else {
    log.error({ response: data }, 'image tag update failed')
  }
}
