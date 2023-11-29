import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'
import { Pool } from 'undici'

declare module 'fastify' {
  interface FastifyInstance {
    pools: {
      get(key: string): Pool
      set(key: string, url: URL, options?: Pool.Options): Pool
    }
  }
}

async function poolsPlugin(fastify: FastifyInstance) {
  const pools = new Map<string, Pool>()

  fastify.addHook('onClose', () =>
    Promise.all(Array.from(pools.values()).map(pool => pool.close())),
  )

  fastify.decorate('pools', {
    get(key) {
      const pool = pools.get(key)
      if (!pool) {
        throw new Error(`Pool ${key} not set`)
      }
      return pool
    },
    set(key, url, options) {
      let pool = pools.get(key)
      if (!pool) {
        pool = new Pool(url.origin, {
          connections: 32,
          pipelining: 1,
          ...options,
        })
        pools.set(key, pool)
      }
      return pool
    },
  })
}

export default plugin(poolsPlugin, {
  name: 'pools',
})
