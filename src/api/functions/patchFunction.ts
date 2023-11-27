import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getFunctionByName } from '../../lib/function.js'
import { type ContainerImage, isSameImage } from '../../lib/image.js'
import { REGISTRY_ISSUER } from '../../lib/token.js'
import { invoke } from '../request.js'

export interface RouteGeneric {
  Body: {
    image: ContainerImage
  }
  Params: {
    functionName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PATCH',
  url: '/api/v1/functions/:functionName',
  config: {
    tokenIssuer: REGISTRY_ISSUER,
  },
  schema: {
    tags: ['function'],
    params: S.object()
      .additionalProperties(false)
      .prop('functionName', S.string())
      .required(),
    body: S.object()
      .additionalProperties(false)
      .prop(
        'image',
        S.object()
          .additionalProperties(false)
          .prop('host', S.string())
          .required()
          .prop('name', S.string())
          .required()
          .prop('tag', S.string())
          .required(),
      )
      .required(),
    response: {
      '2xx': S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json')),
    },
  },
  async handler(request, reply) {
    const { auth, store } = this
    const { body, params, session } = request

    const oldFn = await getFunctionByName(store, params.functionName)
    if (!oldFn) {
      return reply.code(404).error({ message: 'Function not found.' })
    }

    const resAuth = await auth.authorize(session, 'publisher', oldFn.project)
    if (resAuth.isErr) {
      return reply.code(403).error(resAuth.unwrapErr())
    }

    if (isSameImage(oldFn.image, body.image)) {
      return { function: oldFn }
    }
    if (
      oldFn.image.host !== body.image.host ||
      oldFn.image.name !== body.image.name
    ) {
      return reply.code(409).error({ message: 'Registry mismatch.' })
    }

    const newFn = await store.functions
      .from(oldFn)
      .update(fn => ({
        ...fn,
        image: {
          ...fn.image,
          tag: body.image.tag,
        },
      }))
      .unwrap()

    const resInvoke = await invoke(this, session.token, newFn, {
      runtimeTest: true,
    })
    if (resInvoke.isErr) {
      return reply.error(resInvoke.unwrapErr())
    }

    reply.code(201)
    return {
      function: newFn,
      invocation: resInvoke.unwrap(),
    }
  },
})
