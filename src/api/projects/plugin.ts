import type { FastifyInstance } from '@brer/fastify'

import readProjectV1 from './v1/readProject.js'
import updateProjectV1 from './v1/updateProject.js'

export default async function (fastify: FastifyInstance) {
  fastify.route(readProjectV1()).route(updateProjectV1())
}
