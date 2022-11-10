import { FastifyInstance } from 'fastify'

import internalAuth from './lib/auth.js'

import v1DownloadPayload from './v1/downloadPayload.js'

export default async function (fastify: FastifyInstance) {
  fastify.register(internalAuth)

  fastify.route(v1DownloadPayload)
}
