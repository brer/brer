import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'

async function probesPlugin(fastify: FastifyInstance) {
  const logLevel = 'warn'

  fastify.route({
    method: 'GET',
    url: '/probes/liveness',
    logLevel,
    async handler(request, reply) {
      const [couchdb] = await Promise.all([
        this.store.nano.info(),
        this.kubernetes.api.CoreApi.getAPIVersions(),
      ])
      if (couchdb.couchdb !== 'Welcome') {
        request.log.warn({ response: couchdb }, 'unexpected couchdb response')
        return reply.error({
          code: 'PROBE_FAILURE',
          message: 'Database connection error.',
          status: 500,
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
