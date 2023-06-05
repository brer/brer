import type { FastifyInstance } from 'fastify'

import deleteInvocationV1 from './v1/deleteInvocation.js'
import downloadPayloadV1 from './v1/downloadPayload.js'
import readInvocationV1 from './v1/readInvocation.js'
import readLogsV1 from './v1/readLogs.js'
import searchInvocationsV1 from './v1/searchInvocations.js'

export default async function (fastify: FastifyInstance) {
  fastify.route(deleteInvocationV1)
  fastify.route(downloadPayloadV1)
  fastify.route(readInvocationV1)
  fastify.route(readLogsV1)
  fastify.route(searchInvocationsV1)
}
