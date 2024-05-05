import type { RouteOptions } from '@brer/fastify'
import type { FnRuntime } from '@brer/function'
import S from 'fluent-json-schema-es'

import { getFunctionByName } from '../../lib/function.js'
import { isSameImage, type ContainerImage } from '../../lib/image.js'
import { INVOKER_ISSUER } from '../../lib/tokens.js'

export interface RouteGeneric {
  Body: {
    image: ContainerImage
    runtime: FnRuntime
  }
  Params: {
    functionName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/api/v1/functions/:functionName/runtime',
  config: {
    tokenIssuer: INVOKER_ISSUER,
  },
  schema: {
    tags: ['function'],
    params: S.object().prop('functionName', S.string()).required(),
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
      .required()
      .prop(
        'runtime',
        S.object()
          .additionalProperties(true)
          .prop('type', S.string().enum(['Go', 'Node.js', 'Rust', 'Unknown']))
          .required(),
      )
      .required(),
    response: {
      200: S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { store } = this
    const { body, params, session } = request

    const [oldFn, invocation] = await Promise.all([
      getFunctionByName(store, params.functionName),
      store.invocations.find(session.token.subject).unwrap(),
    ])
    if (!oldFn) {
      return reply.code(404).error({ message: 'Function not found.' })
    }
    if (invocation?.functionName !== params.functionName) {
      return reply.code(403).error({ message: 'Foreign Function write.' })
    }
    if (!isSameImage(oldFn.image, body.image, true)) {
      return reply.code(422).error({ message: 'Image mismatch.' })
    }

    const newFn = await store.functions
      .from(oldFn)
      .assign({ runtime: body.runtime })
      .unwrap()

    return { function: newFn }
  },
})
