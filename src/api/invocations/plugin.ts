import type { FastifyInstance } from 'fastify'

import v1DeleteInvocation from './v1/deleteInvocation.js'
import v1DownloadPayload from './v1/downloadPayload.js'
import v1PatchInvocation from './v1/patchInvocation.js'
import v1ReadInvocation from './v1/readInvocation.js'
import v1ReadLogs from './v1/readLogs.js'

export default async function (fastify: FastifyInstance) {
  fastify.route(v1DeleteInvocation)
  fastify.route(v1DownloadPayload)
  fastify.route(v1PatchInvocation)
  fastify.route(v1ReadInvocation)
  fastify.route(v1ReadLogs)
}
