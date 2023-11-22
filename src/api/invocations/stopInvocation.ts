import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'
import { type Pool } from 'undici'

import { signUserToken } from '../../lib/token.js'

export interface RouteGeneric {
  Params: {
    invocationId: string
  }
}

export default (invoker: Pool): RouteOptions<RouteGeneric> => ({
  method: 'POST',
  url: '/api/v1/invocations/:invocationId/stop',
  schema: {
    tags: ['invocation'],
    params: S.object()
      .additionalProperties(false)
      .prop('invocationId', S.string().format('uuid'))
      .required(),
    body: S.object(),
    response: {
      200: S.object()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json'))
        .required(),
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

    const result = await auth.authorize(session, 'invoker', invocation.project)
    if (result.isErr) {
      return reply.code(403).error(result.unwrapErr())
    }

    if (invocation.status === 'completed' || invocation.status === 'failed') {
      return reply.code(409).error({ message: 'Invocation not running.' })
    }

    const token = await signUserToken(session.username)

    const response = await invoker.request({
      method: 'PUT',
      path: `/invoker/v1/invocations/${invocation._id}/status/failed`,
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
      return { invocation: data.invocation }
    } else if (response.statusCode === 404) {
      return reply.code(404).error()
    } else {
      return reply.code(response.statusCode).error(data.error)
    }
  },
})
