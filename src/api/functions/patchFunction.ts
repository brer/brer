import type {
  FastifyInstance,
  FastifyRequest,
  RouteOptions,
} from '@brer/fastify'
import type { Fn, FnRuntime } from '@brer/function'
import type { Invocation } from '@brer/invocation'
import S from 'fluent-json-schema-es'

import { AsyncRequestResult } from '../../lib/error.js'
import { getFunctionByName, updateFunction } from '../../lib/function.js'
import { isSameImage, type ContainerImage } from '../../lib/image.js'
import * as Result from '../../lib/result.js'
import {
  API_ISSUER,
  INVOKER_ISSUER,
  REGISTRY_ISSUER,
  signApiToken,
} from '../../lib/token.js'
import { isPlainObject } from '../../lib/util.js'
import { invoke } from '../request.js'

export interface RouteGeneric {
  Body: {
    image?: Partial<ContainerImage>
    runtime?: FnRuntime
  }
  Params: {
    functionName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PATCH',
  url: '/api/v1/functions/:functionName',
  config: {
    tokenIssuer: [API_ISSUER, INVOKER_ISSUER, REGISTRY_ISSUER],
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
        S.object()
          .additionalProperties(true)
          .prop('type', S.string().enum(['Go', 'Node.js', 'Rust', 'Unknown'])),
      ),
    response: {
      200: S.object()
        .prop('function', S.ref('https://brer.io/schema/v1/function.json'))
        .required()
        .prop('invocation', S.ref('https://brer.io/schema/v1/invocation.json')),
    },
  },
  async handler(request, reply) {
    const { store } = this
    const { body, params, session } = request

    const oldFn = await getFunctionByName(store, params.functionName)
    if (!oldFn) {
      return reply.code(404).error({ message: 'Function not found.' })
    }

    const resAuth = await authorizePatch(this, request)
    if (resAuth.isErr) {
      return reply.error(resAuth.unwrapErr())
    }

    const requestInvocation = resAuth.unwrap()

    const newFn = await store.functions
      .from(oldFn)
      .update(doc =>
        requestInvocation
          ? doc
          : updateFunction(doc, {
              ...doc,
              image: {
                ...doc.image,
                ...body.image,
              },
            }),
      )
      .update(doc =>
        requestInvocation &&
        isSameImage(doc.image, requestInvocation.image) &&
        body.runtime
          ? setFunctionRuntime(doc, requestInvocation)
          : doc,
      )
      .unwrap()

    let testInvocation: any
    if (!isSameImage(oldFn.image, newFn.image) && !requestInvocation) {
      // Registry tokens cannot be used by the Invoker.
      // Map the Registry token into a Api token.
      const token = await signApiToken(session.token.subject)
      const resInvoke = await invoke(this, token, newFn, {
        runtimeTest: true,
      })
      if (resInvoke.isErr) {
        return reply.error(resInvoke.unwrapErr())
      } else {
        testInvocation = resInvoke.unwrap()
      }
    }

    return {
      function: newFn,
      invocation: testInvocation,
    }
  },
})

async function authorizePatch(
  { auth, store }: FastifyInstance,
  { params, session }: FastifyRequest<RouteGeneric>,
): AsyncRequestResult<Invocation | null> {
  if (session.token.issuer === INVOKER_ISSUER) {
    const invocation = await store.invocations
      .find(session.token.subject)
      .unwrap()

    if (invocation?.functionName === params.functionName) {
      return Result.ok(invocation)
    }
  } else {
    const result = await auth.authorize(
      session,
      session.token.issuer === REGISTRY_ISSUER ? 'publisher' : 'admin',
      params.functionName,
    )
    return result.map(() => null)
  }

  return Result.err({ status: 403 })
}

function setFunctionRuntime(fn: Fn, invocation: Invocation): Fn {
  if (!isSameImage(fn.image, invocation.image)) {
    throw new Error(
      `Invocation ${invocation._id} doesn't represent ${fn.name} runtime`,
    )
  }
  if (invocation.status === 'failed') {
    return {
      ...fn,
      runtime: {
        type: 'Failure',
        reason: invocation.reason,
      },
    }
  }
  if (invocation.status !== 'completed') {
    throw new Error('Invalid Invocation status')
  }
  return {
    ...fn,
    runtime: getFunctionRuntime(invocation.result),
  }
}

function getFunctionRuntime(result: unknown): FnRuntime {
  if (
    isPlainObject(result) &&
    isPlainObject(result.runtime) &&
    typeof result.runtime.type === 'string'
  ) {
    return result.runtime as FnRuntime
  } else {
    return {
      type: 'Unknown',
      result,
    }
  }
}
