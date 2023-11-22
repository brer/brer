import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'
import { Pool } from 'undici'

declare module 'fastify' {
  interface FastifyInstance {
    createPool(url: URL, options?: Pool.Options): Pool
  }
}

async function poolsPlugin(fastify: FastifyInstance) {
  const pools: Pool[] = []

  fastify.addHook('onClose', () => Promise.all(pools.map(pool => pool.close())))

  fastify.decorate('createPool', (url, options) => {
    const pool = new Pool(url.origin, {
      connections: 32,
      pipelining: 1,
      ...options,
    })
    pools.push(pool)
    return pool
  })
}

export default plugin(poolsPlugin, {
  name: 'pools',
})
