import type { FnEnv } from '@brer/types'
import { constantCase } from 'case-anything'
import { FastifyRequest, RouteOptions } from 'fastify'
import S from 'fluent-json-schema-es'
import got from 'got'
import * as uuid from 'uuid'

import { getDefaultSecretName } from '../../../lib/function.js'
import { encodeToken } from '../../../lib/token.js'

interface RouteGeneric {
  Params: {
    functionName: string
  }
}

const route: RouteOptions = {
  method: 'POST',
  url: '/api/v1/functions/:functionName',
  schema: {
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
    body: S.object().additionalProperties(true), // TODO: support arbitrary payload
    response: {
      202: S.object()
        .additionalProperties(false)
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json'))
        .required(),
      404: S.object()
        .prop('error', S.ref('https://brer.io/schema/v1/error.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { database, kubernetes } = this
    const { body, headers, log, params } =
      request as FastifyRequest<RouteGeneric>

    const fn = await database.functions
      .find({ name: params.functionName })
      .unwrap()

    if (!fn) {
      return reply.code(404).error()
    }

    // TODO: override default envs, ensure env name uniqueness
    const env: FnEnv[] = [...fn.env]
    const keys = Object.keys(headers).filter(key => /^x-brer-env-/.test(key))
    for (const key of keys) {
      env.push({
        name: constantCase(key.substring(11)),
        value: request.headers[key] + '',
      })
    }
    for (const obj of env) {
      if (/^BRER_/i.test(obj.name)) {
        // TODO: 400
        throw new Error('Reserved env name')
      }
    }

    const invocationId = uuid.v4()
    const now = new Date()
    const payload = Buffer.from(JSON.stringify(body)) // TODO: get raw body, and add support for non-JSON body
    const status = 'pending'
    const token = encodeToken(invocationId)

    const invocation = await database.invocations
      .create({
        _id: invocationId,
        status,
        phases: [
          {
            date: now.toISOString(),
            status,
          },
        ],
        env,
        image: fn.image,
        functionName: fn.name,
        secretName: fn.secretName || getDefaultSecretName(fn.name),
        tokenSignature: token.signature,
        _attachments: {
          payload: {
            content_type: headers['content-type'] || 'application/octet-stream',
            data: payload.toString('base64'),
          },
        },
        createdAt: now.toISOString(),
      })
      .unwrap()

    try {
      await got({
        method: 'POST',
        url: 'rpc/v1/invoke',
        prefixUrl:
          process.env.PUBLIC_URL ||
          `http://brer-invoker.${kubernetes.namespace}.svc.cluster.local/`,
        headers: {
          authorization: `Bearer ${token.value}`,
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
}

export default route
