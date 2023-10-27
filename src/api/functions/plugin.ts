import type { FastifyInstance } from '@brer/fastify'

import deleteFunctionV1 from './v1/deleteFunction.js'
import readFunctionV1 from './v1/readFunction.js'
import searchFunctionsV1 from './v1/searchFunctions.js'
import triggerFunctionV1 from './v1/triggerFunction.js'
import updateFunctionV1 from './v1/updateFunction.js'

export default async function (fastify: FastifyInstance) {
  fastify
    .route(deleteFunctionV1())
    .route(readFunctionV1())
    .route(searchFunctionsV1())
    .register(triggerFunctionV1)
    .route(updateFunctionV1())
}
