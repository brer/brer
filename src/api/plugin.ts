import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import cookies from '@fastify/cookie'
import got from 'got'

import { encodeToken } from '../lib/token.js'
import authRoutes from './auth.js'
import functionsRoutes from './functions/plugin.js'
import functionSchema from './functions/schema.js'
import invocationsRoutes from './invocations/plugin.js'
import invocationSchema from './invocations/schema.js'

export interface PluginOptions {
  cookieSecret?: string
  notifyController?: boolean
}

export default async function apiPlugin(
  fastify: FastifyInstance,
  options: PluginOptions,
) {
  if (!options.cookieSecret) {
    throw new Error('Required env var COOKIE_SECRET is missing')
  }

  fastify.register(cookies, {
    hook: 'onRequest',
    secret: options.cookieSecret,
  })

  // Register global schema ($ref)
  functionSchema(fastify)
  invocationSchema(fastify)

  await authRoutes(fastify)
  await functionsRoutes(fastify)
  await invocationsRoutes(fastify)

  if (options.notifyController) {
    const { kubernetes, log } = fastify
    fastify.events.on(
      'brer.invocations.invoke',
      ({ invocation }: { invocation: Invocation }) => {
        got({
          method: 'POST',
          url: 'rpc/v1/invoke',
          prefixUrl: `http://brer-controller.${kubernetes.namespace}.svc.cluster.local/`,
          headers: {
            authorization: `Bearer ${encodeToken(invocation._id).value}`,
          },
          json: {},
        }).catch(err => log.warn({ err }, 'failed to contact the controller')) // the controller will recover later (if alive), just print a warning
      },
    )
  }
}
