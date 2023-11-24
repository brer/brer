import { SignJWT, jwtVerify } from 'jose'
import { v4 as uuid } from 'uuid'

if (!process.env.JWT_SECRET) {
  throw new Error('Env value for JWT_SECRET is missing')
}

const JWT_ALGORITHM = 'HS256'
const JWT_SECRET = Buffer.from(process.env.JWT_SECRET)

export const API_ISSUER = 'brer.io/api'
export const INVOKER_ISSUER = 'brer.io/invoker'

export interface Token {
  id: string
  subject: string
  raw: string
  issuer: string
  expires: number
}

export async function signApiToken(username: string): Promise<Token> {
  const id = uuid()
  const expires = Date.now() + 900000 // 15 minutes (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(expires)
    .setJti(id)
    .setIssuer(API_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
    expires,
    id,
    issuer: API_ISSUER,
    raw,
    subject: username,
  }
}

export async function signInvocationToken(
  invocationId: string,
): Promise<Token> {
  const id = uuid()
  const expires = Date.now() + 86400000 // 24 hours (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(expires)
    .setJti(id)
    .setIssuer(INVOKER_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(invocationId)
    .sign(JWT_SECRET)

  return {
    expires,
    id,
    issuer: INVOKER_ISSUER,
    raw,
    subject: invocationId,
  }
}

/**
 * Resolves with JWT subject (`invocationId` or `username`).
 */
export async function verifyToken(
  raw: string,
  audience: string,
  issuer?: string | string[],
): Promise<Token> {
  const { payload } = await jwtVerify(raw, JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
    issuer,
    audience,
  })
  return {
    expires: payload.exp ?? Number.POSITIVE_INFINITY,
    id: payload.jti || uuid(),
    issuer: payload.iss || '',
    raw,
    subject: payload.sub || '',
  }
}
