import type { FastifyInstance, RouteOptions } from '@brer/fastify'
import type { FnEnv } from '@brer/function'
import type { Invocation } from '@brer/invocation'
import type { V1Secret } from '@kubernetes/client-node'
import S from 'fluent-json-schema-es'

import {
  getFunctionId,
  getFunctionSecretName,
  updateFunction,
} from '../../../lib/function.js'
import { createInvocation } from '../../../lib/invocation.js'

interface RouteGeneric {
  Body: {
    env?: {
      name: string
      value?: string
      secretName?: string
      secretKey?: string
    }[]
    image: string
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
      .prop('image', S.string().minLength(3).maxLength(256))
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
      ),
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
    const { database } = this
    const { body, params } = request

    const counter: Record<string, number | undefined> = {}
    const envs = body.env || []

    for (const env of envs) {
      if (counter[env.name]) {
        // No duplicates
        return reply.code(400).error({
          message: `Env ${env.name} was already declared.`,
          info: { env },
        })
      }

      counter[env.name] = 1
      if (/^BRER_/i.test(env.name)) {
        // All `BRER_` envs are reserved
        return reply.code(400).error({
          message: `Env ${env.name} uses a reserved name.`,
          info: { env },
        })
      } else if (env.value && env.secretName && env.secretKey) {
        // Secrets writings is allowed only for scoped secrets
        return reply.code(400).error({
          message: `Env ${env.name} tries to write a private secret.`,
          info: { env },
        })
      } else if (env.secretName && !env.secretKey) {
        // Secret references must be complete
        return reply.code(400).error({
          message: `Env ${env.name} is missing secret key reference.`,
          info: { env },
        })
      } else if (!env.value && !env.secretKey) {
        // Disallow unreferenced secrets
        return reply.code(400).error({
          message: `Env ${env.name} does not reference any secret.`,
          info: { env },
        })
      }
    }

    // TODO: handle errors
    await pushPrivateSecrets(this, params.functionName, envs)

    let invocation: Invocation | undefined

    const functionId = getFunctionId(params.functionName)
    const fn = await database.functions
      .read(functionId)
      .ensure({
        _id: functionId,
        name: params.functionName,
        image: '',
        env: [],
      })
      .update(fn =>
        updateFunction(fn, {
          env: envs,
          image: body.image,
        }),
      )
      .tap(async fn => {
        if (!fn.runtime) {
          // Create Invocation before Fn commit
          invocation = await database.invocations
            .create(
              createInvocation({
                fn,
                env: {
                  BRER_MODE: 'test',
                },
              }),
            )
            .unwrap()
        }
      })
      .unwrap()

    if (invocation) {
      this.events.emit('brer.invocations.invoke', { invocation })
    }

    reply.code(invocation ? 202 : 200)
    return {
      function: fn,
      invocation,
    }
  },
})

async function pushPrivateSecrets(
  { kubernetes }: FastifyInstance,
  functionName: string,
  envs: FnEnv[],
) {
  envs = Array.from(getPrivateEnvs(envs))
  if (!envs.length) {
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
    stringData: envs.reduce(
      (acc, item) => {
        acc[item.secretKey!] = item.value!
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
