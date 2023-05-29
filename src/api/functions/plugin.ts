import type { FastifyInstance } from 'fastify'

import createFunctionV1 from './v1/createFunction.js'
import readFunctionV1 from './v1/readFunction.js'
import searchFunctionsV1 from './v1/searchFunctions.js'
import triggerFunctionV1 from './v1/triggerFunction.js'
import updateFunctionV1 from './v1/updateFunction.js'

export default async function (fastify: FastifyInstance) {
  fastify.route(createFunctionV1)
  fastify.route(readFunctionV1)
  fastify.route(searchFunctionsV1)
  fastify.route(triggerFunctionV1)
  fastify.route(updateFunctionV1)
}
