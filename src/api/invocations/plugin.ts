import type { FastifyInstance } from '@brer/fastify'

import deleteInvocationV1 from './v1/deleteInvocation.js'
import downloadPayloadV1 from './v1/downloadPayload.js'
import readInvocationV1 from './v1/readInvocation.js'
import readLogsV1 from './v1/readLogs.js'
import searchInvocationsV1 from './v1/searchInvocations.js'
import stopInvocationV1 from './v1/stopInvocation.js'

export default async function (fastify: FastifyInstance) {
  fastify
    .route(deleteInvocationV1())
    .route(downloadPayloadV1())
    .route(readInvocationV1())
    .route(readLogsV1())
    .route(searchInvocationsV1())
    .route(stopInvocationV1())
}
