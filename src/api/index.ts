import type { CouchStore, Fn } from '@brer/types'

export default async function createFunctionsIndexes(store: CouchStore<Fn>) {
  await store.adapter.createIndex({
    index: {
      fields: ['createdAt'],
    },
  })
  await store.adapter.createIndex({
    index: {
      fields: ['name'],
    },
  })
}
