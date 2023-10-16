import type { FastifyInstance } from '@brer/types'
import { constantCase } from 'case-anything'
import S from 'fluent-json-schema-es'
import got from 'got'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { getFunctionId } from '../../../lib/function.js'
import { createInvocation } from '../../../lib/invocation.js'
import { encodeToken } from '../../../lib/token.js'

interface RouteGeneric {
  Body: Buffer
  Params: {
    functionName: string
  }
}

export default async function plugin(fastify: FastifyInstance) {
  fastify.removeAllContentTypeParsers()

  fastify.addContentTypeParser('*', (request, payload, done) => {
    toBuffer(payload)
      .then(buffer => done(null, buffer))
      .catch(done)
  })

  fastify.route<RouteGeneric>({
    method: 'POST',
    url: '/api/v1/functions/:functionName',
    schema: {
      tags: ['function', 'invocation'],
      params: S.object()
        .additionalProperties(false)
        .prop(
          'functionName',
          S.string()
            .minLength(3)
            .maxLength(256)
            .pattern(/^[a-z][0-9a-z\-]+[0-9a-z]$/),
        )
        .required(),
      headers: S.object()
        .additionalProperties(true)
        .patternProperties({
          '^x-brer-env-': S.string().maxLength(4096),
        }),
      response: {
        202: S.object()
          .additionalProperties(false)
          .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
          .required()
          .prop(
            'invocation',
            S.ref('https://brer.io/schema/v1/invocation.json'),
          )
          .required(),
      },
    },
    async handler(request, reply) {
      const { database, kubernetes } = this
      const { body, headers, log, params } = request

      const fn = await database.functions
        .find(getFunctionId(params.functionName))
        .unwrap()

      if (!fn) {
        return reply.code(404).error()
      }

      const env: Record<string, string> = {}
      const keys = Object.keys(headers).filter(key => /^x-brer-env-/.test(key))
      for (const key of keys) {
        const value = request.headers[key]
        if (typeof value === 'string' || value === undefined) {
          const envName = constantCase(key.substring(11))
          if (/^BRER_/i.test(envName)) {
            return reply.code(412).error({
              message: `Header ${key} uses a reserved env name.`,
            })
          }
          env[envName] = value || ''
        }
      }

      const invocation = await database.invocations
        .create(
          createInvocation({
            contentType: headers['content-type'],
            env,
            fn,
            payload: body,
          }),
        )
        .unwrap()

      try {
        await got({
          method: 'POST',
          url: 'rpc/v1/invoke',
          prefixUrl:
            process.env.PUBLIC_URL ||
            `http://brer-controller.${kubernetes.namespace}.svc.cluster.local/`,
          headers: {
            authorization: `Bearer ${encodeToken(invocation._id).value}`,
          },
          json: {},
        })
      } catch (err) {
        // the controller will recover later (if alive), just print a warning
        log.warn({ err }, 'failed to contact the controller')
      }

      reply.code(202)
      return {
        function: fn,
        invocation,
      }
    },
  })
}

async function toBuffer(readable: Readable) {
  const chunks: Buffer[] = []

  // TODO: encoding?
  await pipeline(
    readable,
    new Writable({
      decodeStrings: true,
      objectMode: false,
      write(chunk, encoding, callback) {
        chunks.push(Buffer.from(chunk, encoding))
        callback()
      },
    }),
  )

  return Buffer.concat(chunks)
}
