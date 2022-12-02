import type { FnEnv } from '@brer/types'
import * as textCase from 'case'
import { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'

import { createInvocation } from '../../invocations/lib/invocation.js'

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
    const { database } = this
    const { body, headers, params } = request as FastifyRequest<RouteGeneric>

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
        name: textCase.constant(key.substring(11)),
        value: request.headers[key] + '',
      })
    }
    for (const obj of env) {
      if (/^BRER_/i.test(obj.name)) {
        // TODO: 400
        throw new Error('Reserved env name')
      }
    }

    const contentType = headers['content-type'] || 'application/octet-stream'
    const payload = Buffer.from(JSON.stringify(body)) // TODO: get raw body, and add support for non-JSON body

    const invocation = await database.invocations
      .create(
        createInvocation({
          env,
          functionName: fn.name,
          image: fn.image,
        }),
      )
      .commit()
      .update(doc =>
        database.invocations.adapter.attach(doc, {
          data: payload,
          name: 'payload',
          contentType,
        }),
      )
      .tap(doc => {
        // Ingore pending Promise
        this.pendingInvocations.push(doc)
      })
      .unwrap({
        mutent: {
          commitMode: 'MANUAL',
        },
      })

    reply.code(202)
    return {
      function: fn,
      invocation: invocation,
    }
  },
}

export default route
