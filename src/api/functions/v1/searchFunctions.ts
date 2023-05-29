import type { RouteOptions } from 'fastify'
import S from 'fluent-json-schema-es'

const route: RouteOptions = {
  method: 'GET',
  url: '/api/v1/functions',
  schema: {
    response: {
      200: S.object()
        .additionalProperties(false)
        .prop(
          'functions',
          S.array().items(S.ref('https://brer.io/schema/v1/function.json')),
        )
        .required(),
    },
  },
  async handler() {
    const { database } = this

    const fns = await database.functions.filter({}).unwrap()

    return { functions: fns }
  },
}

export default route
