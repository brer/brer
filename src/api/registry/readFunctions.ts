import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { REGISTRY_ISSUER } from '../../lib/token.js'

interface PartialFn {
  name: string
  project: string
}

export default (publicUrl: URL): RouteOptions => ({
  method: 'GET',
  url: '/api/v1/registry/functions',
  config: {
    tokenIssuer: REGISTRY_ISSUER,
  },
  schema: {
    tags: ['function'],
    response: {
      200: S.object()
        .additionalProperties(false)
        .prop('functions', S.array().minItems(1).items(S.string()))
        .required(),
    },
  },
  async handler(request, reply) {
    const { auth, store } = this
    const { session } = request

    if (!session.token.repository) {
      return reply.code(403).error() // skip couchdb request
    }

    const response = await store.functions.adapter.scope.view<PartialFn[]>(
      'default',
      'registry',
      {
        group: true,
        key: [publicUrl.host, session.token.repository],
        reduce: true,
        sorted: false,
      },
    )

    // list of projects
    let projects: string[] = []

    // list of (partial) functions
    let fns = response.rows?.[0]?.value || []

    // unique the list of projects
    for (const obj of fns) {
      if (!projects.includes(obj.project)) {
        projects.push(obj.project)
      }
    }

    // authorize the current user for the requested projects
    const results = await Promise.all(
      projects.map(project => auth.authorize(session, 'publisher', project)),
    )

    // keep only authorized projects
    projects = results.filter(r => r.isOk).map(r => r.unwrap())

    // keep only authorized functions
    fns = fns.filter(obj => projects.includes(obj.project))
    if (!fns.length) {
      return reply.code(403).error()
    }

    return {
      functions: fns.map(obj => obj.name),
    }
  },
})
