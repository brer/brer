export interface AuthorizationBasic {
  type: 'basic'
  username: string
  password: string
}

export interface AuthorizationBearer {
  type: 'bearer'
  token: string
}

export type Authorization = AuthorizationBasic | AuthorizationBearer

const CREDENTIALS_REGEXP =
  /^ *(?:[Bb][Aa][Ss][Ii][Cc]) +([A-Za-z0-9._~+/-]+=*) *$/

const USER_PASS_REGEXP = /^([^:]*):(.*)$/

function decodeBase64(value: string) {
  return Buffer.from(value, 'base64').toString()
}

export function parseAuthorizationHeader(
  header: unknown,
): Authorization | null {
  if (typeof header == 'string') {
    const basic = CREDENTIALS_REGEXP.exec(header)
    if (basic) {
      const data = USER_PASS_REGEXP.exec(decodeBase64(basic[1]))
      if (data) {
        return {
          type: 'basic',
          username: data[1],
          password: data[2],
        }
      }
    } else if (/^bearer /i.test(header)) {
      return {
        type: 'bearer',
        token: header.substring(7),
      }
    }
  }
  return null
}

export function parseAuthorization(headers: unknown) {
  return parseAuthorizationHeader(Object(headers).authorization)
}
