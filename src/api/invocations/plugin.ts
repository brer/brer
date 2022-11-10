import { FastifyInstance } from 'fastify'

import v1DeleteInvocation from './v1/deleteInvocation.js'
import v1ReadInvocation from './v1/readInvocation.js'
import v1ReadLogs from './v1/readLogs.js'

export default async function (fastify: FastifyInstance) {
  fastify.route(v1DeleteInvocation)
  fastify.route(v1ReadInvocation)
  fastify.route(v1ReadLogs)
}
