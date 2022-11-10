import * as textCase from 'case'
import { FastifyRequest, RouteOptions } from 'fastify'
import { default as S } from 'fluent-json-schema'
import * as uuid from 'uuid'

import { reserveInvocation } from '../../invocations/lib/invocation.js'
import { getPodTemplate } from '../../invocations/lib/kubernetes.js'
import { writePayload } from '../../invocations/lib/payload.js'
import { InvocationStatus } from '../../invocations/lib/types.js'
import { FnEnv } from '../lib/types.js'

interface RouteGeneric {
  Params: {
    functionName: string
  }
}

const route: RouteOptions = {
  method: 'POST',
  url: '/api/v1/functions/:functionName/trigger',
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
      // TODO: 404
      throw new Error('Function not found')
    }

    // TODO: override default envs, ensure env name uniqueness, and prevent usage of "BRER_" prefix
    const env: FnEnv[] = [...fn.env]
    const keys = Object.keys(headers).filter(key => /^x-brer-env-/.test(key))
    for (const key of keys) {
      env.push({
        name: textCase.constant(key.substring(11)),
        value: request.headers[key] + '',
      })
    }

    const invocationId = uuid.v4()

    // TODO: get raw body
    const payload = Buffer.from(JSON.stringify(body))
    await writePayload(invocationId, payload)

    const date = new Date().toISOString()
    const status = InvocationStatus.Pending
    const invocation = await database.invocations
      .create({
        _id: invocationId,
        status: InvocationStatus.Pending,
        phases: [{ date, status }],
        env,
        image: fn.image,
        functionName: fn.name,
        contentType: headers['content-type'] || 'application/octet-stream',
        payloadSize: payload.byteLength,
        createdAt: date,
      })
      .commit()
      .update(reserveInvocation)
      .commit()
      .tap(async data => {
        const result = await kubernetes.api.CoreV1Api.createNamespacedPod(
          kubernetes.namespace,
          getPodTemplate(data),
        )
        log.debug({ pod: result.body.metadata?.name }, 'pod created')
      })
      .unwrap()

    reply.code(202)
    return {
      function: fn,
      invocation: invocation,
    }
  },
}

export default route
