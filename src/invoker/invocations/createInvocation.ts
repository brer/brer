import type { RouteOptions } from '@brer/fastify'
import type { InvocationImage } from '@brer/invocation'
import S from 'fluent-json-schema-es'
import { type CouchDocumentAttachment } from 'mutent-couchdb'
import { v4 as uuid } from 'uuid'

import { API_ISSUER, REGISTRY_ISSUER } from '../../lib/tokens.js'

export interface RouteGeneric {
  Body: {
    env: any[]
    image: InvocationImage
    functionName: string
    project: string
    /**
     * Base64
     */
    payload?: string
    /**
     * Payload's content type.
     */
    contentType?: string
    retries?: number
    runtimeTest?: boolean
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
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'POST',
  url: '/invoker/v1/invocations',
  config: {
    tokenIssuer: [API_ISSUER, REGISTRY_ISSUER],
  },
  schema: {
    body: S.object()
      .prop('env', S.array().items(S.object().additionalProperties(true)))
      .required()
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
      .prop('functionName', S.string().minLength(1))
      .required()
      .prop('project', S.string().minLength(1))
      .required()
      .prop('payload', S.string().pattern(/^[A-Za-z0-9+/]*={0,3}$/))
      .prop('contentType', S.string())
      .prop('retries', S.integer().minimum(0).maximum(10).default(0))
      .prop('runtimeTest', S.boolean())
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
  },
  async handler(request, reply) {
    const { events, store } = this
    const { body } = request

    const attachments: Record<string, CouchDocumentAttachment> = {}
    const now = new Date()
    const status = 'pending'

    if (body.payload?.length) {
      attachments.payload = {
        content_type: body.contentType || 'application/octet-stream',
        data: body.payload,
      }
    }

    const invocation = await store.invocations
      .create({
        _id: uuid(),
        _attachments: attachments,
        status,
        phases: [
          {
            date: now.toISOString(),
            status,
          },
        ],
        env: body.env,
        image: body.image,
        functionName: body.functionName,
        project: body.project,
        createdAt: now.toISOString(),
        resources: body.resources,
        retries: body.retries || 0,
        runtimeTest: body.runtimeTest,
      })
      .unwrap()

    events.emit('brer.io/invocations/created', invocation._id)

    reply.code(201)
    return { invocation }
  },
})
