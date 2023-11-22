import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'
import { type Pool } from 'undici'

import { type AsyncRequestResult } from '../../lib/error.js'
import * as Result from '../../lib/result.js'
import { signUserToken } from '../../lib/token.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (invoker: Pool): RouteOptions<RouteGeneric> => ({
  method: 'DELETE',
  url: '/api/v1/invocations/:invocationId',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    response: {
      204: S.null(),
    },
  },
  async handler(request, reply) {
    const { auth, store } = this
    const { params, session } = request

    const invocation = await store.invocations
      .find(params.invocationId)
      .unwrap()
    if (!invocation) {
      return reply.code(404).error({ message: 'Invocation not found.' })
    }

    const resAuth = await auth.authorize(session, 'admin', invocation.project)
    if (resAuth.isErr) {
      return reply.error(resAuth.unwrapErr())
    }

    const resDelete = await deleteInvocation(
      invoker,
      session.username,
      invocation._id,
    )
    if (resDelete.isErr) {
      return reply.error(resAuth.unwrapErr())
    }

    return reply.code(204).send()
  },
})

export async function deleteInvocation(
  invoker: Pool,
  username: string,
  invocationId: String,
): AsyncRequestResult<null> {
  const token = await signUserToken(username)

  const response = await invoker.request({
    method: 'DELETE',
    path: `/invoker/v1/invocations/${invocationId}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: '{}',
  })

  const body: any = await response.body.json()
  if (response.statusCode === 204 || response.statusCode === 404) {
    return Result.ok(null)
  } else {
    return Result.err({ ...body.error, status: response.statusCode })
  }
}
