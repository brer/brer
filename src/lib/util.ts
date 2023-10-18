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
