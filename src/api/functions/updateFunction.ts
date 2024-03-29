import type { FastifyRequest, RouteOptions } from '@brer/fastify'
import type { FnEnv, FnResources } from '@brer/function'
import S from 'fluent-json-schema-es'
import Result from 'ultres'

import type { RequestResult } from '../../lib/error.js'
import {
  createFunction,
  getFunctionByName,
  updateFunction,
} from '../../lib/function.js'
import {
  type ContainerImage,
  parseImagePath,
  IMAGE_PATH_REGEXP,
  IMAGE_TAG_REGEXP,
  IMAGE_HOST_REGEXP,
  IMAGE_NAME_REGEXP,
} from '../../lib/image.js'
import { invoke, pushFunctionSecrets } from '../request.js'

export interface RouteGeneric {
  Body: {
    env?: {
      name: string
      value?: string
      secretName?: string
      secretKey?: string
    }[]
    image: string | ContainerImage
    project?: string
    historyLimit?: number
    resources?: {
      requests?: {
        cpu?: string
        memory?: string
      }
      limits?: {
        cpu?: string
        memory?: string
      }
    }
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
        'project',
        S.string()
          .default('default')
          .maxLength(128)
          .pattern(/^[a-zA-Z0-9_\-]+$/),
      )
      .prop('historyLimit', S.integer().minimum(0))
      .prop(
        'resources',
        S.object()
          .additionalProperties(false)
          .prop(
            'requests',
            S.object()
              .additionalProperties(false)
              .prop('cpu', S.string())
              .prop('memory', S.string()),
          )
          .prop(
            'limits',
            S.object()
              .additionalProperties(false)
              .prop('cpu', S.string())
              .prop('memory', S.string()),
          ),
      ),
    response: {
      '2xx': S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json')),
    },
  },
  async handler(request, reply) {
    const { auth, store } = this
    const { params, session } = request

    const resBody = parseRequest(request)
    if (resBody.isErr) {
      return reply.code(400).error(resBody.unwrapErr())
    }

    const body = resBody.unwrap()

    const oldFn = await getFunctionByName(store, params.functionName)
    if (oldFn) {
      const resRead = await auth.authorize(session, 'admin', oldFn.project)
      if (resRead.isErr) {
        return reply.error(resRead.unwrapErr())
      }
    }

    const resWrite = await auth.authorize(session, 'admin', body.project)
    if (resWrite.isErr) {
      return reply.error(resWrite.unwrapErr())
    }

    const resSecrets = await pushFunctionSecrets(
      this,
      session.token,
      params.functionName,
      serializeFunctionSecrets(body.env),
    )
    if (resSecrets.isErr) {
      return reply.code(409).error(resSecrets.unwrapErr())
    }

    let created = false
    let newFn = await store.functions
      .from(oldFn)
      .ensure(() => {
        created = true
        return createFunction(params.functionName)
      })
      .update(fn => updateFunction(fn, body))
      .unwrap()

    const reference = await getFunctionByName(
      store,
      params.functionName,
      newFn._id,
    )
    if (reference?._id !== newFn._id) {
      return reply.code(409).error({ message: 'Write conflict.' })
    }

    // The `getFunctionByName` function will update the `drafted` flag
    newFn = reference

    let invocation: { _id: string } | undefined
    if (!newFn.runtime) {
      const resInvoke = await invoke(this, session.token, newFn, {
        runtimeTest: true,
      })
      if (resInvoke.isErr) {
        return reply.error(resInvoke.unwrapErr())
      }

      invocation = resInvoke.unwrap()
      newFn = await store.functions
        .from(newFn)
        .assign({
          runtime: {
            type: 'Inspecting',
            invocationId: invocation._id,
          },
        })
        .unwrap()
    }

    reply.code(created ? 201 : 200)
    return {
      function: newFn,
      invocation,
    }
  },
})

interface ParsedRequest {
  env: FnEnv[]
  historyLimit?: number
  image: ContainerImage
  name: string
  project: string
  resources: FnResources
}

function parseRequest({
  body,
  params,
}: FastifyRequest<RouteGeneric>): RequestResult<ParsedRequest> {
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
    historyLimit: body.historyLimit,
    image,
    name: params.functionName,
    project: body.project || 'default',
    resources: {
      limits: body.resources?.limits || {},
      requests: body.resources?.requests || {},
    },
  })
}

function serializeFunctionSecrets(env: FnEnv[]): Record<string, string> {
  const secrets: Record<string, string> = {}
  for (const obj of env) {
    if (obj.value && obj.secretKey && !obj.secretName) {
      secrets[obj.secretKey] = obj.value
    }
  }
  return secrets
}
