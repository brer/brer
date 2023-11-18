import { type BrerDocument } from '@brer/document'
import { type Entity } from 'mutent'

/**
 * Get last item of an array
 */
export function tail<T>(items: T[] | undefined): T | undefined {
  if (items?.length) {
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
export async function* fixDuplicates<T extends BrerDocument>(
  iterable: AsyncIterable<Entity<T>>,
  entityId: string | undefined,
) {
  let found = false
  for await (const entity of iterable) {
    if (!found) {
      if (!entity.target.draft) {
        found = true
      } else if (entity.target._id === entityId) {
        entity.update({ ...entity.target, draft: undefined })
        found = true
      } else if (isOlderThan(entity.target.createdAt || 0, 60)) {
        entity.delete()
      }
    } else {
      entity.delete()
    }

    yield entity
  }
}

export function pickFirst(value: unknown, index: number) {
  return index === 0
}
