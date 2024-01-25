/**
 * CouchDB view's row.
 */
export interface Row<T> {
  /**
   * CouchDB document identifier.
   */
  id: string
  /**
   * CouchDB view key.
   */
  key: T
}

export function getContinueToken<T>(
  obj: Row<T> | undefined,
  fn?: (key: T) => any,
): string | undefined {
  if (obj) {
    return Buffer.from(
      JSON.stringify([obj.id, fn ? fn(obj.key) : obj.key]),
    ).toString('base64')
  }
}

export function parseContinueToken<T = any>(token: string | undefined) {
  if (token) {
    try {
      const result = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'))
      if (Array.isArray(result) && result.length >= 2) {
        return {
          id: result[0] as string,
          key: result[1] as T,
        }
      }
    } catch (err) {
      // just ignore this error
    }
  }
}
