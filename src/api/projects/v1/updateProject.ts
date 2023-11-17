import type { RouteOptions } from '@brer/fastify'
import type { ProjectRole } from '@brer/project'
import S from 'fluent-json-schema-es'

import {
  createProject,
  getProjectByName,
  updateProject,
} from '../../../lib/project.js'

export interface RouteGeneric {
  Body: {
    namespace: string
    roles: Record<string, ProjectRole>
  }
  Params: {
    projectName: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'PUT',
  url: '/api/v1/projects/:projectName',
  config: {
    admin: true,
  },
  schema: {
    tags: ['admin'],
    params: S.object().prop('projectName', S.string()).required(),
    body: S.object()
      .prop(
        'roles',
        S.object().additionalProperties(
          S.string().enum(['publisher', 'viewer', 'invoker', 'admin']),
        ),
      )
      .required(),
    response: {
      '2xx': S.object()
        .prop('project', S.ref('https://brer.io/schema/v1/project.json'))
        .required(),
    },
  },
  async handler(request, reply) {
    const { store } = this
    const { body, params } = request

    let created = false
    const project = await store.projects
      .read({
        _design: 'default',
        _view: 'by_name',
        startkey: [params.projectName, null],
        endkey: [params.projectName, {}],
      })
      .ensure(() => {
        created = true
        return createProject(params.projectName)
      })
      .update(p => updateProject(p, body))
      .unwrap()

    const reference = await getProjectByName(
      store,
      params.projectName,
      project._id,
    )
    if (reference?._id !== project._id) {
      return reply.error({
        message: 'This operation conflicted with another.',
        status: 409,
      })
    }

    reply.code(created ? 201 : 200)
    return { project }
  },
})
