import type { FastifyInstance } from '@brer/fastify'
import cookies from '@fastify/cookie'

import authRoutes from './auth.js'

import deleteFunctionV1 from './functions/deleteFunction.js'
import patchFunctionV1 from './functions/patchFunction.js'
import readFunctionV1 from './functions/readFunction.js'
import searchFunctionsV1 from './functions/searchFunctions.js'
import triggerFunctionV1 from './functions/triggerFunction.js'
import updateFunctionV1 from './functions/updateFunction.js'

import deleteInvocationV1 from './invocations/deleteInvocation.js'
import downloadPayloadV1 from './invocations/downloadPayload.js'
import readInvocationV1 from './invocations/readInvocation.js'
import readLogsV1 from './invocations/readLogs.js'
import searchInvocationsV1 from './invocations/searchInvocations.js'
import stopInvocationV1 from './invocations/stopInvocation.js'

import readProjectV1 from './projects/readProject.js'
import updateProjectV1 from './projects/updateProject.js'

export interface PluginOptions {
  invokerUrl: URL
}

export default async function apiPlugin(
  fastify: FastifyInstance,
  { invokerUrl }: PluginOptions,
) {
  const invoker = fastify.createPool(invokerUrl)

  fastify.register(cookies, { hook: 'onRequest' })

  await authRoutes(fastify)

  fastify
    .route(deleteFunctionV1(invoker))
    .route(patchFunctionV1(invoker))
    .route(readFunctionV1())
    .route(searchFunctionsV1())
    .register(triggerFunctionV1, { invoker })
    .route(updateFunctionV1(invoker))

  fastify
    .route(deleteInvocationV1(invoker))
    .route(downloadPayloadV1())
    .route(readInvocationV1())
    .route(readLogsV1())
    .route(searchInvocationsV1())
    .route(stopInvocationV1(invoker))

  fastify.route(readProjectV1()).route(updateProjectV1())
}
