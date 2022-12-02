import type { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'

async function probesPlugin(fastify: FastifyInstance) {
  fastify.route({
    method: 'GET',
    url: '/probes/liveness',
    async handler(request, reply) {
      // TODO
      reply.code(204)
    },
  })

  fastify.route({
    method: 'GET',
    url: '/probes/readiness',
    async handler(request, reply) {
      // TODO
      reply.code(204)
    },
  })
}

export default plugin(probesPlugin, {
  name: 'probes',
  decorators: {
    fastify: ['database'],
  },
})
