import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import cookies from '@fastify/cookie'
import { fetch } from 'undici'

import { encodeToken } from '../lib/token.js'
import authRoutes from './auth.js'
import functionsRoutes from './functions/plugin.js'
import functionsSchema from './functions/schema.js'
import invocationsRoutes from './invocations/plugin.js'
import invocationsSchema from './invocations/schema.js'

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
  functionsSchema(fastify)
  invocationsSchema(fastify)

  await authRoutes(fastify)
  await functionsRoutes(fastify)
  await invocationsRoutes(fastify)

  if (options.notifyController) {
    const { kubernetes, log } = fastify

    const invoke = async (invocation: Invocation) => {
      const response = await fetch(
        new URL(
          'rpc/v1/invoke',
          `http://brer-controller.${kubernetes.namespace}.svc.cluster.local/`,
        ),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${encodeToken(invocation._id).value}`,
            'content-type': 'application/json',
          },
          body: '{}',
        },
      )

      if (!response.ok) {
        // the controller will recover later (if alive), just print a warning
        log.warn({ status: response.status }, 'controller error during invoke')
      }

      // consume?
      await response.json()
    }

    fastify.events.on(
      'brer.invocations.invoke',
      ({ invocation }: { invocation: Invocation }) =>
        invoke(invocation).catch(err =>
          log.warn({ err }, 'failed to contact the controller'),
        ),
    )
  }
}
