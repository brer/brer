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
  repository?: string
}

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
    repository: typeof payload.rep === 'string' ? payload.rep : undefined,
  }
}

export interface SignedToken extends Token {
  /**
   * Seconds.
   */
  expiresIn: number
  /**
   * ISO date.
   */
  issuedAt: Date
}

function getExpirationTime(date: Date, seconds: number) {
  return date.getTime() + seconds * 1000
}

export async function signApiToken(username: string): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()
  const expiresIn = 900 // 15 minutes (seconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(API_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
    expiresIn,
    id,
    issuedAt,
    issuer: API_ISSUER,
    raw,
    subject: username,
  }
}

export async function signInvocationToken(
  invocationId: string,
  expiresIn: number,
): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(INVOKER_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(invocationId)
    .sign(JWT_SECRET)

  return {
    expiresIn,
    id,
    issuedAt,
    issuer: INVOKER_ISSUER,
    raw,
    subject: invocationId,
  }
}

export async function signRegistryRefreshToken(
  username: string,
): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()
  const expiresIn = 15724800 // 6 months (seconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(REGISTRY_ISSUER)
    .setAudience(REGISTRY_ISSUER)
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
    expiresIn,
    id,
    issuedAt,
    issuer: REGISTRY_ISSUER,
    raw,
    subject: username,
  }
}

export async function signRegistryAccessToken(
  username: string,
  repository: string | undefined,
): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()
  const expiresIn = 300 // 5 minutes (seconds)

  const raw = await new SignJWT({ rep: repository })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(REGISTRY_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER, REGISTRY_ISSUER])
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
    expiresIn,
    id,
    issuedAt,
    issuer: REGISTRY_ISSUER,
    raw,
    repository,
    subject: username,
  }
}
