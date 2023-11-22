import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'
import { type CouchDocumentAttachment } from 'mutent-couchdb'
import { EventEmitter } from 'node:events'
import { v4 as uuid } from 'uuid'

import { type ContainerImage } from '../../lib/image.js'

export interface RouteGeneric {
  Body: {
    env: any[]
    image: ContainerImage
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
    /**
     *
     */
    runtimeTest?: boolean
  }
}

export default (events: EventEmitter): RouteOptions<RouteGeneric> => ({
  method: 'POST',
  url: '/invoker/v1/invocations',
  schema: {
    body: S.object()
      .prop('env', S.array().items(S.object().additionalProperties(true)))
      .required()
      .prop(
        'image',
        S.object()
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
      .prop('payload', S.string())
      .prop('contentType', S.string())
      .prop('runtimeTest', S.boolean()),
  },
  async handler(request, reply) {
    const { store } = this
    const { body } = request

    const invocationId = uuid()
    const now = new Date()
    const status = 'pending'

    const attachments: Record<string, CouchDocumentAttachment> = {}
    if (body.payload?.length) {
      attachments.payload = {
        content_type: body.contentType || 'application/octet-stream',
        data: body.payload,
      }
    }

    const invocation = await store.invocations
      .create({
        _id: invocationId,
        _attachments: attachments,
        status,
        phases: [
          {
            date: now.toISOString(),
            status,
          },
        ],
        runtimeTest: body.runtimeTest,
        env: body.env,
        image: body.image,
        functionName: body.functionName,
        project: body.project,
        createdAt: now.toISOString(),
      })
      .unwrap()

    events.emit('brer.io/invoker/invocations/created', { invocation })

    reply.code(201)
    return { invocation }
  },
})
