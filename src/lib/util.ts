import { type Entity } from 'mutent'

import { type CouchDocument } from './adapter.js'

/**
 * Get last item of an array
 */
export function tail<T>(items: T[]): T | undefined {
  if (items.length > 0) {
    return items[items.length - 1]
  }
}

/**
 * date is older than seconds
 */
export function isOlderThan(
  date: Date | string | number,
  seconds: number,
): boolean {
  if (typeof date === 'string') {
    date = new Date(date)
  }
  if (date instanceof Date) {
    date = date.getTime()
  }
  return date < Date.now() - seconds * 1000
}

export function isPlainObject(value: unknown): value is Record<any, any> {
  return typeof value === 'object' && value !== null
    ? Object.getPrototypeOf(value) === Object.prototype
    : false
}

/**
 * This function will delete from db all duplicates and remove the draft
 * flag from the correct entity.
 */
export async function* fixDuplicates<T extends CouchDocument>(
  iterable: AsyncIterable<Entity<T>>,
  entityId: string | undefined,
) {
  let index = 0
  for await (const entity of iterable) {
    if (index === 0 && entity.target.draft && entity.target._id === entityId) {
      yield entity.update({ ...entity.target, draft: undefined })
    } else if (index > 0 || isOlderThan(entity.target.createdAt || 0, 60)) {
      yield entity.delete()
    } else {
      yield entity
    }
    index++
  }
}

export function pickFirst(value: unknown, index: number) {
  return index === 0
}
