import type {
  FastifyContext,
  FastifyInstance,
  FastifyReply,
  FastifySchema,
} from '@brer/types'
import plugin from 'fastify-plugin'
import S from 'fluent-json-schema-es'

declare module 'fastify' {
  interface FastifyReply {
    /**
     * Returns the raw response body object.
     */
    error(options?: ErrorOptions): object
    /**
     * Send the error body and returns the `reply` instance.
     */
    sendError(options?: ErrorOptions): this
  }
}

interface ErrorOptions {
  code?: string
  message?: string
  info?: Record<string, any>
}

async function errorPlugin(fastify: FastifyInstance) {
  fastify.decorateReply('error', null)
  fastify.decorateReply('sendError', null)

  fastify.setErrorHandler((err, request, reply) => {
    if (Object(err).validation) {
      request.log.trace({ errors: err.validation }, 'validation error')
      reply.code(400).sendError({
        code: 'VALIDATION_ERROR',
        info: { errors: err.validation },
        message: 'Some request parameters are not valid.',
      })
    } else {
      request.log.error({ err }, 'unhandled error')
      reply.code(500).sendError({
        message: 'Unknown error.',
      })
    }
  })

  fastify.addSchema(
    S.object()
      .id('https://brer.io/schema/error.json')
      .additionalProperties(false)
      .prop('code', S.string())
      .required()
      .prop('message', S.string())
      .required()
      .prop('info', S.object().additionalProperties(true)),
  )

  fastify.addHook<any, FastifyContext, FastifySchema>('onRoute', route => {
    if (/^\/api/.test(route.url)) {
      if (!route.schema) {
        route.schema = {}
      }
      if (!route.schema.response) {
        route.schema.response = {}
      }
      if (!route.schema.response['4xx']) {
        route.schema.response['4xx'] = getResponseSchema()
      }
      if (!route.schema.response['5xx']) {
        route.schema.response['5xx'] = getResponseSchema()
      }
    }
  })

  function errorMethod(this: FastifyReply, options: ErrorOptions = {}) {
    return {
      error: {
        code: options.code || getDefaultErrorCode(this.statusCode),
        message: options.message || 'An error occurred.',
        info: options.info,
      },
    }
  }

  function sendErrorMethod(this: FastifyReply, options?: ErrorOptions) {
    return this.send(this.error(options))
  }

  fastify.addHook('onRequest', (request, reply, done) => {
    reply.error = errorMethod
    reply.sendError = sendErrorMethod
    done()
  })
}

function getDefaultErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST'
    case 401:
      return 'NOT_AUTHENTICATED'
    case 403:
      return 'ACCESS_DENIED'
    case 404:
      return 'RESOURCE_NOT_FOUND'
    case 409:
      return 'CONFLICTING_REQUEST'
    case 412:
      return 'PRECONDITION_FAILED'
    default:
      return 'INTERNAL_ERROR'
  }
}

function getResponseSchema() {
  return S.object()
    .additionalProperties(false)
    .prop('error', S.ref('https://brer.io/schema/error.json'))
    .required()
}

export default plugin(errorPlugin, {
  name: 'error',
})
