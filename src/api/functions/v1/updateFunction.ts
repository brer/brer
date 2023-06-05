import type { RouteOptions } from '@brer/types'
import S from 'fluent-json-schema-es'

import {
  getDefaultSecretName,
  getFunctionId,
  purgeSecrets,
} from '../../../lib/function.js'

interface RouteGeneric {
  Body: {
    env?: { name: string; value: string; secretKey?: string }[]
    image: string
    secretName?: string
  }
  Params: {
    functionName: string
  }
}

const route: RouteOptions<RouteGeneric> = {
  method: 'PUT',
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
              .prop('value', S.string().maxLength(4096).default(''))
              .required()
              .prop('secretKey', S.string().maxLength(256)),
          ),
      )
      .prop('secretName', S.string().maxLength(256)),
    response: {
      200: S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required(),
      404: S.object()
        .prop('error', S.ref('https://brer.io/schema/v1/error.json'))
        .required(),
    },
  },
  async handler(request) {
    const { database, kubernetes } = this
    const { body, params } = request

    // TODO: ensure env name uniqueness and prevent usage of "BRER_" prefix
    const env = body.env || []

    const secretName =
      body.secretName || getDefaultSecretName(params.functionName)

    const secrets = env.filter(item => item.secretKey && item.value)
    if (secrets.length > 0) {
      const template = {
        apiVersion: 'v1',
        kind: 'Secret',
        type: 'Opaque',
        metadata: {
          name: secretName,
          labels: {
            'app.kubernetes.io/managed-by': 'brer.io',
            'brer.io/function-name': params.functionName,
          },
        },
        stringData: secrets.reduce((acc, item) => {
          acc[item.secretKey!] = item.value
          return acc
        }, {}),
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

    const functionId = getFunctionId(params.functionName)

    const fn = await database.functions
      .read(functionId)
      .ensure({
        _id: functionId,
        name: params.functionName,
        image: body.image,
        env: [],
      })
      .assign({
        image: body.image,
        secretName: body.secretName,
        env: purgeSecrets(env),
      })
      .unwrap()

    return { function: fn }
  },
}

export default route
