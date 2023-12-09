import type { FastifyInstance } from '@brer/fastify'
import cookies, { type CookieSerializeOptions } from '@fastify/cookie'
import plugin from 'fastify-plugin'

import deleteFunctionV1 from './functions/deleteFunction.js'
import patchFunctionV1 from './functions/patchFunction.js'
import readFunctionV1 from './functions/readFunction.js'
import searchFunctionsV1 from './functions/searchFunctions.js'
import triggerFunctionV1 from './functions/triggerFunction.js'
import updateFunctionV1 from './functions/updateFunction.js'
import updateRuntimeV1 from './functions/updateRuntime.js'

import deleteInvocationV1 from './invocations/deleteInvocation.js'
import readInvocationV1 from './invocations/readInvocation.js'
import readLogsV1 from './invocations/readLogs.js'
import readPayloadV1 from './invocations/readPayload.js'
import searchInvocationsV1 from './invocations/searchInvocations.js'
import stopInvocationV1 from './invocations/stopInvocation.js'

import readProjectV1 from './projects/readProject.js'
import updateProjectV1 from './projects/updateProject.js'

import readFunctionsV1 from './registry/readFunctions.js'

import createSessionV1 from './session/createSession.js'
import readSessionV1 from './session/readSession.js'

import auth from './auth.js'

export interface PluginOptions {
  adminPassword?: string
  cookieName?: string
  gatewayUrl?: URL
  invokerUrl: URL
  publicUrl: URL
}

async function apiPlugin(
  fastify: FastifyInstance,
  {
    cookieName = 'brer_session',
    invokerUrl,
    adminPassword,
    gatewayUrl,
    publicUrl,
  }: PluginOptions,
) {
  fastify.pools.set('invoker', invokerUrl)

  const cookieOptions: CookieSerializeOptions = {
    domain: process.env.COOKIE_DOMAIN,
    httpOnly: true,
    maxAge: 600, // 10 minutes (seconds)
    path: '/',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    signed: false,
  }

  fastify.register(cookies, { hook: 'onRequest' })
  fastify.register(auth, {
    adminPassword,
    gatewayUrl,
    cookieName,
    cookieOptions,
  })

  fastify
    .route(deleteFunctionV1())
    .route(patchFunctionV1())
    .route(readFunctionV1())
    .route(searchFunctionsV1())
    .register(triggerFunctionV1)
    .route(updateFunctionV1())
    .route(updateRuntimeV1())

  fastify
    .route(deleteInvocationV1())
    .route(readInvocationV1())
    .route(readLogsV1())
    .route(readPayloadV1())
    .route(searchInvocationsV1())
    .route(stopInvocationV1())

  fastify.route(readProjectV1()).route(updateProjectV1())

  fastify.route(readFunctionsV1(publicUrl))

  fastify
    .route(createSessionV1(cookieName, cookieOptions))
    .route(readSessionV1())
}

export default plugin(apiPlugin, {
  name: 'api',
  decorators: {
    fastify: ['token', 'store'],
  },
  encapsulate: true,
})
