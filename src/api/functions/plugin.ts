import { FastifyInstance } from 'fastify'

import v1CreateFunction from './v1/createFunction.js'
import v1ReadFunction from './v1/readFunction.js'
import v1TriggerFunction from './v1/triggerFunction.js'
import v1UpdateFunction from './v1/updateFunction.js'

export default async function (fastify: FastifyInstance) {
  fastify.route(v1CreateFunction)
  fastify.route(v1ReadFunction)
  fastify.route(v1TriggerFunction)
  fastify.route(v1UpdateFunction)
}
