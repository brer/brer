import type { FastifyContext, FastifyInstance } from '@brer/fastify'
import type { Fn, FnEnv } from '@brer/function'
import { constantCase } from 'case-anything'
import S from 'fluent-json-schema-es'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { type Pool } from 'undici'

import { AsyncRequestResult } from '../../lib/error.js'
import { getFunctionByName, getFunctionSecretName } from '../../lib/function.js'
import * as Result from '../../lib/result.js'
import { signUserToken } from '../../lib/token.js'

export interface RouteGeneric {
  Body: Buffer
  Params: {
    functionName: string
  }
}

export interface PluginOptions {
  invoker: Pool
}

export default async function plugin(
  fastify: FastifyInstance,
  { invoker }: PluginOptions,
) {
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
      const { auth, store } = this
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

      const resInvoke = await invoke(invoker, session.username, fn, {
        contentType: headers['content-type'],
        env,
        payload: body,
      })
      if (resInvoke.isErr) {
        return reply.error(resInvoke.unwrapErr())
      }

      reply.code(202)
      return {
        function: fn,
        invocation: resInvoke.unwrap(),
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

export interface InvokeOptions {
  /**
   * Override some envs.
   */
  env?: Record<string, string>
  /**
   * Optional Invocation payload.
   */
  payload?: Buffer
  /**
   * Payload's content type.
   */
  contentType?: string
  /**
   * Execute "runtime test" mode.
   */
  runtimeTest?: boolean
}

export async function invoke(
  invoker: Pool,
  username: string,
  fn: Fn,
  options: InvokeOptions = {},
): AsyncRequestResult {
  const token = await signUserToken(username)

  const response = await invoker.request({
    method: 'POST',
    path: '/invoker/v1/invocations',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      env: mergeEnv(fn, options.env),
      runtimeTest: options.runtimeTest,
      image: fn.image,
      functionName: fn.name,
      project: fn.project,
      payload: options.payload?.toString('base64'),
      contentType: options?.contentType,
    }),
  })

  const body: any = await response.body.json()
  if (response.statusCode === 201) {
    return Result.ok(body.invocation)
  } else {
    return Result.err({ ...body.error, status: response.statusCode })
  }
}

function mergeEnv(fn: Fn, record: Record<string, string> = {}) {
  const keys = Object.keys(record)
  const secret = getFunctionSecretName(fn.name)

  const env: FnEnv[] = keys
    .map(key => ({
      name: key,
      value: record[key],
    }))
    .filter(item => item.value.length > 0) // Empty strings will remove some envs

  for (const obj of fn.env) {
    if (!keys.includes(obj.name)) {
      if (obj.secretKey) {
        env.push({
          name: obj.name,
          secretName: obj.secretName || secret,
          secretKey: obj.secretKey,
        })
      } else {
        env.push({
          name: obj.name,
          value: obj.value,
        })
      }
    }
  }

  return env
}
