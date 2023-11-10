import type {
  FastifyInstance,
  FastifyRequest,
  RouteOptions,
} from '@brer/fastify'
import type { FnEnv } from '@brer/function'
import type { Invocation } from '@brer/invocation'
import type { V1Secret } from '@kubernetes/client-node'
import S from 'fluent-json-schema-es'

import type { RequestResult } from '../../../lib/error.js'
import {
  createFunction,
  getFunctionId,
  getFunctionSecretName,
  updateFunction,
} from '../../../lib/function.js'
import {
  type ContainerImage,
  parseImagePath,
  IMAGE_PATH_REGEXP,
  IMAGE_TAG_REGEXP,
  IMAGE_HOST_REGEXP,
  IMAGE_NAME_REGEXP,
} from '../../../lib/image.js'
import { createInvocation } from '../../../lib/invocation.js'
import * as Result from '../../../lib/result.js'

export interface RouteGeneric {
  Body: {
    env?: {
      name: string
      value?: string
      secretName?: string
      secretKey?: string
    }[]
    image: string | ContainerImage
    group?: string
    historyLimit?: number
    exposeRegistry?: boolean
  }
  Params: {
    functionName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/api/v1/functions/:functionName',
  schema: {
    tags: ['function'],
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
    body: S.object()
      .additionalProperties(false)
      .prop(
        'image',
        S.oneOf([
          S.string().minLength(3).maxLength(256).pattern(IMAGE_PATH_REGEXP),
          S.object()
            .additionalProperties(false)
            .prop(
              'host',
              S.string().minLength(1).maxLength(512).pattern(IMAGE_HOST_REGEXP),
            )
            .required()
            .prop(
              'name',
              S.string()
                .minLength(1)
                .maxLength(4096)
                .pattern(IMAGE_NAME_REGEXP),
            )
            .required()
            .prop(
              'tag',
              S.string().minLength(1).maxLength(128).pattern(IMAGE_TAG_REGEXP),
            )
            .required(),
        ]),
      )
      .required()
      .prop(
        'env',
        S.array()
          .maxItems(20)
          .items(
            S.object()
              .additionalProperties(false)
              .prop(
                'name',
                S.string()
                  .minLength(1)
                  .maxLength(256)
                  .pattern(/^[0-9A-Za-z_]+$/),
              )
              .required()
              .prop('value', S.string().maxLength(4096).minLength(1))
              .prop('secretName', S.string().maxLength(256).minLength(1))
              .prop('secretKey', S.string().maxLength(256).minLength(1)),
          ),
      )
      .prop(
        'group',
        S.string()
          .maxLength(128)
          .pattern(/^[a-zA-Z0-9_\-]+$/),
      )
      .prop('historyLimit', S.integer().minimum(0))
      .prop('exposeRegistry', S.boolean()),
    response: {
      200: S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required(),
      202: S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { gateway, store } = this
    const { log, params, session } = request

    const bodyResult = parseRequest(request)
    if (bodyResult.isErr) {
      return reply.code(400).error(bodyResult.unwrapErr())
    }

    const body = bodyResult.unwrap()

    const oldFn = await store.functions
      .find(getFunctionId(params.functionName))
      .unwrap()

    if (oldFn) {
      const readResult = await gateway.authorize(session.username, 'api_read', [
        oldFn.group,
      ])
      if (readResult.isErr) {
        return reply.code(403).error(readResult.unwrapErr())
      }
    }

    const writeResult = await gateway.authorize(session.username, 'api_write', [
      body.group,
    ])
    if (writeResult.isErr) {
      return reply.code(403).error(writeResult.unwrapErr())
    }

    try {
      await pushPrivateSecrets(this, params.functionName, body.env)
    } catch (err) {
      log.error({ err }, 'secret write error')
      return reply
        .code(409)
        .error({ message: 'Cannot write scoped Kubernetes secrets.' })
    }

    const tmpFn = oldFn ? updateFunction(oldFn, body) : createFunction(body)

    let invocation: Invocation | undefined
    if (!tmpFn.runtime) {
      // Create Invocation before Fn write
      invocation = await store.invocations
        .create(
          createInvocation({
            fn: tmpFn,
            env: {
              BRER_MODE: 'test',
            },
          }),
        )
        .unwrap()
    }

    if (invocation) {
      this.events.emit('brer.invocations.invoke', { invocation })
    }

    const newFn = await store.functions
      .from(oldFn)
      .update(() => tmpFn)
      .ensure(tmpFn)
      .unwrap()

    reply.code(invocation ? 202 : 200)
    return {
      function: newFn,
      invocation,
    }
  },
})

interface ParsedRequest {
  env: FnEnv[]
  group: string
  historyLimit?: number
  image: ContainerImage
  name: string
  exposeRegistry?: boolean
}

function parseRequest({
  body,
  params,
  session,
}: FastifyRequest<RouteGeneric>): RequestResult<ParsedRequest> {
  const group = body.group || session.username

  const image =
    typeof body.image === 'string' ? parseImagePath(body.image) : body.image
  if (!image) {
    return Result.err({
      message: 'Invalid image.',
      info: { image: body.image },
    })
  }

  const counter: Record<string, boolean | undefined> = {}
  const env = body.env || []

  for (const obj of env) {
    if (counter[obj.name]) {
      return Result.err({
        message: `Env ${obj.name} was already declared.`,
        info: { env: obj },
      })
    }

    counter[obj.name] = true
    if (/^BRER_/i.test(obj.name)) {
      // All `BRER_` envs are reserved
      return Result.err({
        message: `Env ${obj.name} uses a reserved name.`,
        info: { env: obj },
      })
    } else if (obj.value && obj.secretName && obj.secretKey) {
      // Secrets writings is allowed only for scoped secrets
      return Result.err({
        message: `Env ${obj.name} tries to write a private secret.`,
        info: { env: obj },
      })
    } else if (obj.secretName && !obj.secretKey) {
      // Secret references must be complete
      return Result.err({
        message: `Env ${obj.name} is missing secret key reference.`,
        info: { env: obj },
      })
    } else if (!obj.value && !obj.secretKey) {
      // Disallow unreferenced secrets
      return Result.err({
        message: `Env ${obj.name} does not reference any secret.`,
        info: { env: obj },
      })
    }
  }

  return Result.ok({
    env,
    group,
    historyLimit: body.historyLimit,
    image,
    name: params.functionName,
    exposeRegistry: body.exposeRegistry,
  })
}

async function pushPrivateSecrets(
  { kubernetes }: FastifyInstance,
  functionName: string,
  env: FnEnv[],
) {
  env = Array.from(getPrivateEnvs(env))
  if (!env.length) {
    return
  }

  const secretName = getFunctionSecretName(functionName)

  const template: V1Secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    type: 'Opaque',
    metadata: {
      name: secretName,
      labels: {
        'app.kubernetes.io/managed-by': 'brer.io',
        'brer.io/function-name': functionName,
      },
    },
    stringData: env.reduce(
      (acc, obj) => {
        acc[obj.secretKey!] = obj.value!
        return acc
      },
      {} as Record<string, string>,
    ),
  }

  const exists = await kubernetes.api.CoreV1Api.readNamespacedSecret(
    secretName,
    kubernetes.namespace,
    undefined,
  ).catch(err =>
    err?.response?.statusCode === 404 ? null : Promise.reject(err),
  )
  if (exists) {
    await kubernetes.api.CoreV1Api.patchNamespacedSecret(
      secretName,
      kubernetes.namespace,
      template,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          'content-type': 'application/merge-patch+json',
        },
      },
    )
  } else {
    await kubernetes.api.CoreV1Api.createNamespacedSecret(
      kubernetes.namespace,
      template,
    )
  }
}

function* getPrivateEnvs(envs: FnEnv[]) {
  for (const env of envs) {
    if (env.value && env.secretKey && !env.secretName) {
      yield env
    }
  }
}
