import type { FastifyInstance } from '@brer/types'

import readFunctionV1 from './v1/readFunction.js'
import searchFunctionsV1 from './v1/searchFunctions.js'
import triggerFunctionV1 from './v1/triggerFunction.js'
import updateFunctionV1 from './v1/updateFunction.js'

export default async function (fastify: FastifyInstance) {
  readFunctionV1(fastify)
  searchFunctionsV1(fastify)
  updateFunctionV1(fastify)

  fastify.register(triggerFunctionV1)
}
