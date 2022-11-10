import { RouteOptions } from 'fastify'

import { runInvocation } from '../../invocations/lib/invocation.js'
import { readPayload } from '../../invocations/lib/payload.js'

const route: RouteOptions = {
  method: 'POST',
  url: '/_api/v1/download',
  async handler(request, reply) {
    const { database } = this

    const invocation = await database.invocations
      .find(request.invocationId)
      .filter(data => data.status === 'running')
      .unwrap()

    if (!invocation) {
      // TODO: 403
      throw new Error('Unknown token')
    }

    const payload = await readPayload(invocation._id!)
    if (!payload) {
      // TODO
      throw new Error()
    }
    if (invocation.payloadSize !== payload.byteLength) {
      // TODO
      throw new Error()
    }

    await database.invocations.from(invocation).update(runInvocation).unwrap()

    reply
      .type(invocation.contentType)
      .header('x-brer-function-name', invocation.functionName)
      .header('x-brer-invocation-id', invocation._id)

    return payload
  },
}

export default route
