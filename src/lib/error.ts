import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'
import { default as S } from 'fluent-json-schema'

declare module 'fastify' {
  interface FastifyReply {
    error(options?: ErrorOptions): object
  }
}

interface ErrorOptions {
  code?: string
  message?: string
  info?: Record<any, any>
}

async function errorPlugin(fastify: FastifyInstance) {
  // TODO: error handler

  fastify.decorateReply('error', null)

  fastify.addSchema(
    S.object()
      .id('https://brer.io/schema/v1/error.json')
      .additionalProperties(false)
      .prop('code', S.string())
      .required()
      .prop('message', S.string())
      .required()
      .prop('info', S.object().additionalProperties(true)),
  )

  fastify.addHook('onRequest', (request, reply, done) => {
    reply.error = (options = {}) => ({
      error: {
        code: options.code || getDefaultErrorCode(reply.statusCode),
        message: options.message || 'An error occurred.',
        info: options.info,
      },
    })
    done()
  })
}

function getDefaultErrorCode(statusCode: number): string {
  switch (statusCode) {
    case 401:
      return 'NOT_AUTHENTICATED'
    case 403:
      return 'ACCESS_DENIED'
    case 404:
      return 'DOCUMENT_NOT_FOUND'
    case 409:
      return 'CONFLICTING_REQUEST'
    case 500:
      return 'INTERNAL_ERROR'
    default:
      return 'UNKNOWN_ERROR'
  }
}

export default plugin(errorPlugin, {
  name: 'error',
})
