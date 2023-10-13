import type { FastifyInstance } from '@brer/types'

import deleteInvocationV1 from './v1/deleteInvocation.js'
import downloadPayloadV1 from './v1/downloadPayload.js'
import readInvocationV1 from './v1/readInvocation.js'
import readLogsV1 from './v1/readLogs.js'
import searchInvocationsV1 from './v1/searchInvocations.js'

export default async function (fastify: FastifyInstance) {
  deleteInvocationV1(fastify)
  downloadPayloadV1(fastify)
  readInvocationV1(fastify)
  readLogsV1(fastify)
  searchInvocationsV1(fastify)
}
