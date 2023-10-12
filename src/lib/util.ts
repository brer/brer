import { StringDecoder } from 'node:string_decoder'

/**
 * Split text by newline (unix).
 */
export async function* toTextLines(
  iterable: AsyncIterable<Buffer>,
  encoding: BufferEncoding = 'utf-8',
  limitBytes: number = Number.POSITIVE_INFINITY,
): AsyncGenerator<string> {
  const decoder = new StringDecoder(encoding)

  let bytes = 0
  let text = ''
  for await (const buffer of iterable) {
    bytes += buffer.byteLength
    text += decoder.write(buffer)

    const items = text.split(/[\r\n]+/)
    text = items.pop() || ''

    for (const item of items) {
      yield item
    }
  }

  text += decoder.end()
  if (text.length > 0) {
    // skip partial lines (when using limitBytes qs field)
    if (bytes < limitBytes) {
      yield text
    }
  }
}

/**
 * Parse a RFC3339 or RFC3339Nano timestamp.
 */
export function parseRfcDate(rfc: string): Date {
  // TODO: this works, but It's not "technically correct"
  return new Date(rfc)
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
