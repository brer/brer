import type {
  FastifyContext,
  FastifyInstance,
  FastifyReply,
  FastifySchema,
} from '@brer/fastify'
import plugin from 'fastify-plugin'
import S from 'fluent-json-schema-es'
import { type IResult } from 'ultres'

declare module 'fastify' {
  interface FastifyReply {
    /**
     * Returns the raw response body object.
     */
    error(options?: ErrorOptions): object
    /**
     * Send the error body and returns the `reply` instance.
     * Useful inside hooks.
     */
    sendError(options?: ErrorOptions): this
  }
}

export interface ErrorOptions {
  /**
   * ERROR_CODE.
   */
  code?: string
  message?: string
  info?: Record<string, unknown>
  /**
   * @default 500
   */
  statusCode?: number
}

export type RequestResult<T = unknown> = IResult<T, ErrorOptions>

async function errorPlugin(fastify: FastifyInstance) {
  fastify.decorateReply('error', null)
  fastify.decorateReply('sendError', null)

  fastify.setErrorHandler((err, request, reply) => {
    // TODO: handle couchdb "conflict" error
    if (Object(err).validation) {
      request.log.trace({ errors: err.validation }, 'validation error')
      reply.sendError({
        code: 'VALIDATION_ERROR',
        info: { errors: err.validation },
        message: 'Some request parameters are not valid.',
        statusCode: 400,
      })
    } else {
      request.log.error({ err }, 'unhandled error')
      reply.sendError({
        message: 'Unknown error.',
        statusCode: 500,
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
    const statusCode = options.statusCode || notOk(this.statusCode)
    if (this.statusCode !== statusCode) {
      this.code(statusCode)
    }

    return {
      error: {
        code: options.code || getDefaultErrorCode(statusCode),
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

function notOk(value: number) {
  return value === 200 ? 500 : value
}

function getDefaultErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST'
    case 401:
      return 'UNAUTHORIZED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    case 410:
      return 'GONE'
    case 412:
      return 'PRECONDITION_FAILED'
    case 422:
      return 'UNPROCESSABLE_CONTENT'
    case 500:
      return 'INTERNAL_SERVER_ERROR'
    default:
      return 'UNKNOWN_ERROR'
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
