import type { FastifyContext, FastifyInstance } from '@brer/fastify'
import { constantCase } from 'case-anything'
import S from 'fluent-json-schema-es'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { getFunctionByName } from '../../../lib/function.js'
import { createInvocation } from '../../../lib/invocation.js'

export interface RouteGeneric {
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

  fastify.route<RouteGeneric, FastifyContext>({
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
      const { auth, helmsman, store } = this
      const { body, headers, params, session } = request

      const fn = await getFunctionByName(store, params.functionName)
      if (!fn) {
        return reply.code(404).error({ message: 'Function not found.' })
      }

      const result = await auth.authorize(session, 'invoker', fn.project)
      if (result.isErr) {
        return reply.error(result.unwrapErr())
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

      const invocation = await store.invocations
        .create(
          createInvocation({
            contentType: headers['content-type'],
            env,
            fn,
            payload: body,
          }),
        )
        .unwrap()

      await helmsman.invoke(invocation)

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
