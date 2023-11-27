export function matchAndMap<V, M>(
  value: V,
  regex: RegExp,
  map: (value: string) => M,
): V | M {
  return typeof value === 'string' && regex.test(value) ? map(value) : value
}

export const REG_INT = /^[+\-]?\d+$/

export function asInteger<T>(value: T): T | number {
  return matchAndMap(value, REG_INT, parseInt)
}

export function asBoolean<T>(value: T): T | boolean {
  switch (value) {
    case '':
    case 'false':
      return false
    case 'true':
      return true
    default:
      return value
  }
}
