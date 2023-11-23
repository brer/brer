import { SignJWT, jwtVerify } from 'jose'
import { v4 as uuid } from 'uuid'

if (!process.env.JWT_SECRET) {
  throw new Error('Env value for JWT_SECRET is missing')
}

const JWT_ALGORITHM = 'HS256'
const JWT_SECRET = Buffer.from(process.env.JWT_SECRET)

export const API_ISSUER = 'brer.io/api'
export const INVOKER_ISSUER = 'brer.io/invoker'
export const REGISTRY_ISSUER = 'brer.io/registry'

export interface Token {
  id: string
  subject: string
  raw: string
  issuer: string
}

export async function signApiToken(username: string): Promise<Token> {
  const id = uuid()
  const ms = 900000 // 15 minutes (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(Date.now() + ms)
    .setJti(id)
    .setIssuer(API_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
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
  const ms = 86400000 // 24 hours (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(Date.now() + ms)
    .setJti(id)
    .setIssuer(INVOKER_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(invocationId)
    .sign(JWT_SECRET)

  return {
    id,
    issuer: INVOKER_ISSUER,
    raw,
    subject: invocationId,
  }
}

export async function signRegistryToken(username: string): Promise<Token> {
  const id = uuid()
  const ms = 300000 // 5 minutes (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(Date.now() + ms)
    .setJti(id)
    .setIssuer(REGISTRY_ISSUER)
    .setAudience([API_ISSUER, REGISTRY_ISSUER])
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
    id,
    issuer: REGISTRY_ISSUER,
    raw,
    subject: username,
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
    id: payload.jti || uuid(),
    issuer: payload.iss || '',
    raw,
    subject: payload.sub || '',
  }
}
