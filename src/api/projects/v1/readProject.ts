import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { getProjectByName } from '../../../lib/project.js'

export interface RouteGeneric {
  Params: {
    projectName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/api/v1/projects/:projectName',
  config: {
    admin: true,
  },
  schema: {
    tags: ['admin'],
    params: S.object().prop('projectName', S.string()).required(),
    response: {
      200: S.object()
        .prop('project', S.ref('https://brer.io/schema/v1/project.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { store } = this
    const { params } = request

    const project = await getProjectByName(store, params.projectName)
    if (project) {
      return { project }
    } else {
      return reply.code(404).error({ message: 'Project not found.' })
    }
  },
})
