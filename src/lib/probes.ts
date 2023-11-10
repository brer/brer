import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'

async function probesPlugin(fastify: FastifyInstance) {
  const logLevel = 'warn'

  fastify.route({
    method: 'GET',
    url: '/probes/liveness',
    logLevel,
    async handler(request, reply) {
      // TODO: test k8s

      const response = await this.store.nano.info()
      if (response.couchdb !== 'Welcome') {
        request.log.warn({ response }, 'unexpected couchdb response')
        return reply.code(500).error({
          code: 'PROBE_FAILURE',
          message: 'Database connection error.',
        })
      }

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
  decorators: {
    fastify: ['store'],
  },
})
