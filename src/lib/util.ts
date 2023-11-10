import * as uuid from 'uuid'

const UUID_NAMESPACE = process.env.UUID_NAMESPACE || ''
if (!UUID_NAMESPACE) {
  throw new Error('Please set the UUID_NAMESPACE environment value')
}

export function deriveUUID(value: string) {
  return uuid.v5(value, UUID_NAMESPACE)
}

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
