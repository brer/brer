import type { RouteOptions } from '@brer/fastify'
import type { FnRuntime } from '@brer/function'
import S from 'fluent-json-schema-es'
import { type Pool } from 'undici'

import { getFunctionByName, updateFunction } from '../../lib/function.js'
import { type ContainerImage } from '../../lib/image.js'
import { invoke } from './triggerFunction.js'

export interface RouteGeneric {
  Body: {
    image?: Partial<ContainerImage>
    runtime?: Partial<FnRuntime>
  }
  Params: {
    functionName: string
  }
}

export default (invoker: Pool): RouteOptions<RouteGeneric> => ({
  method: 'PATCH',
  url: '/api/v1/functions/:functionName',
  config: {
    tokenIssuer: ['brer.io/api', 'brer.io/registry'],
  },
  schema: {
    tags: ['function'],
    params: S.object()
      .prop(
        'functionName',
        S.string()
          .minLength(3)
          .maxLength(256)
          .pattern(/^[a-z][0-9a-z\-]+[0-9a-z]$/),
      )
      .required(),
    body: S.object()
      .prop(
        'image',
        S.object()
          .prop('host', S.string())
          .prop('name', S.string())
          .prop('tag', S.string()),
      )
      .prop(
        'runtime',
        S.object().additionalProperties(true).prop('type', S.string()),
      ),
    response: {
      200: S.object()
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

    const result = await auth.authorize(session, 'admin', oldFn.project)
    if (result.isErr) {
      return reply.error(result.unwrapErr())
    }

    // TODO: set runtime (only invoker can do that)
    const newFn = await store.functions
      .from(oldFn)
      .update(doc =>
        updateFunction(doc, {
          ...doc,
          image: {
            ...doc.image,
            host: body.image?.host || doc.image.host,
            name: body.image?.name || doc.image.name,
            tag: body.image?.tag || doc.image.tag,
          },
        }),
      )
      .unwrap()

    let invocation: any
    if (!newFn.runtime) {
      const resInvoke = await invoke(invoker, session.username, newFn, {
        runtimeTest: true,
      })
      if (resInvoke.isErr) {
        return reply.error(resInvoke.unwrapErr())
      } else {
        invocation = resInvoke.unwrap()
      }
    }

    return {
      function: newFn,
      invocation,
    }
  },
})
