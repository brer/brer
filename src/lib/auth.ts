import { FastifyInstance } from 'fastify'
import { default as plugin } from 'fastify-plugin'

async function authPlugin(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    // TODO: implement something better :)
    if (
      !/^\/_api\//.test(request.url) &&
      request.headers.authorization !==
        'Bearer isweariwillimplementarealauthenticationservice'
    ) {
      // TODO: 401
      throw new Error('Not authenticated')
    }
  })
}

export default plugin(authPlugin, {
  name: 'auth',
})
