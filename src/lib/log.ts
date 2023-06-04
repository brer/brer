import type {
  InvocationLog,
  InvocationLogLine,
  InvocationLogPage,
} from '@brer/types'

import { parseRfcDate, tail } from './util.js'

export async function* parseLogLines(
  iterable: AsyncIterable<string>,
): AsyncGenerator<InvocationLogLine> {
  const regex =
    /^((?:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?))(Z|[\+-]\d{2}:\d{2})?) /

  for await (const text of iterable) {
    const matches = text.match(regex)
    if (matches) {
      const timestamp = matches[1]
      yield {
        date: parseRfcDate(timestamp).getTime(),
        timestamp,
        value: text.substring(matches[0].length),
      }
    }
  }
}

export function pushLines(
  doc: InvocationLog,
  lines: InvocationLogLine[],
  date: number,
): InvocationLog {
  const lastLine = tail(lines)
  if (lastLine) {
    date = Math.max(date, lastLine.date)
  }

  if (doc.date > date) {
    // document was updated by someone else
    return doc
  }

  const oldPage = tail(doc.pages)

  const index = lines.findIndex(
    !oldPage
      ? () => true
      : line =>
          line.date >= oldPage.lastLine.date &&
          line.value !== oldPage.lastLine.value,
  )
  if (index < 0) {
    // no need to push those lines, but the date needs an update
    return { ...doc, date }
  }

  const newPage: InvocationLogPage = {
    attachment: `page_${date}.txt`,
    date,
    lastLine: lastLine!,
  }

  return {
    ...doc,
    _attachments: {
      ...doc._attachments,
      [newPage.attachment]: {
        content_type: 'text/plain; charset=utf-8',
        data: Buffer.from(
          lines
            .slice(index)
            .map(line => line.value)
            .join('\n'),
          'utf-8',
        ).toString('base64'),
      },
    },
    pages: [...doc.pages, newPage],
  }
}
