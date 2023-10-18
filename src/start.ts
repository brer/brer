import type {} from '@fastify/swagger' // Just import types

if (process.env.SERVER_MODE === 'init') {
  await import('./init.js')
} else {
  await import('./listen.js')
}
