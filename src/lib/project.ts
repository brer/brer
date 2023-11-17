import type { FastifyInstance } from '@brer/fastify'
import type { Project } from '@brer/project'
import { v4 as uuid } from 'uuid'

import { fixDuplicates, pickFirst } from './util.js'

export function createProject(projectName: string): Project {
  return {
    _id: uuid(),
    draft: true,
    name: projectName,
    roles: {},
  }
}

export function updateProject(
  project: Project,
  options: Pick<Project, 'roles'>,
): Project {
  return {
    ...project,
    roles: {
      ...options.roles,
      admin: 'admin',
    },
  }
}

/**
 * This function also fix duplicates.
 */
export async function getProjectByName(
  store: FastifyInstance['store'],
  projectName: string,
  projectId?: string,
): Promise<Project | null> {
  const projects = await store.projects
    .filter({
      _design: 'default',
      _view: 'by_name',
      startkey: [projectName, null],
      endkey: [projectName, {}],
    })
    .pipe(iterable => fixDuplicates(iterable, projectId))
    .commit()
    .filter(pickFirst)
    .unwrap()

  return projects.length ? projects[0] : null
}
