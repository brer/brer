import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'

async function probesPlugin(fastify: FastifyInstance) {
  const logLevel = 'warn'

  fastify.route({
    method: 'GET',
    url: '/probes/liveness',
    logLevel,
    async handler(request, reply) {
      // TODO: ping pools?
      await Promise.all([
        this.kubernetes ? this.kubernetes.api.CoreApi.getAPIVersions() : null,
        this.store ? this.store.nano.info() : null,
      ])

      return reply.code(204).send()
    },
  })

  fastify.route({
    method: 'GET',
    url: '/probes/readiness',
    logLevel,
    async handler(request, reply) {
      // TODO: what?
      return reply.code(204).send()
    },
  })
}

export default plugin(probesPlugin, {
  name: 'probes',
})
