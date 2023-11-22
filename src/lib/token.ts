import { SignJWT, jwtVerify } from 'jose'
import { v4 as uuid } from 'uuid'

if (!process.env.JWT_SECRET) {
  throw new Error('Env value for JWT_SECRET is missing')
}

const JWT_ALGORITHM = 'HS256'
const JWT_SECRET = Buffer.from(process.env.JWT_SECRET)

export interface Token {
  id: string
  subject: string
  raw: string
  issuer: string
}

export async function signUserToken(username: string): Promise<Token> {
  const id = uuid()
  const issuer = 'brer.io/api'
  const ms = 900000 // 15 minutes (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(Date.now() + ms)
    .setJti(id)
    .setIssuer(issuer)
    .setAudience(['brer.io/api', 'brer.io/invoker'])
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
    id,
    issuer,
    raw,
    subject: username,
  }
}

export async function signInvocationToken(
  invocationId: string,
): Promise<Token> {
  const id = uuid()
  const issuer = 'brer.io/invoker'
  const ms = 86400000 // 24 hours (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(Date.now() + ms)
    .setJti(id)
    .setIssuer(issuer)
    .setAudience('brer.io/invoker')
    .setSubject(invocationId)
    .sign(JWT_SECRET)

  return {
    id,
    issuer,
    raw,
    subject: invocationId,
  }
}

export async function signRegistryToken(username: string): Promise<Token> {
  const id = uuid()
  const issuer = 'brer.io/registry'
  const ms = 300000 // 5 minutes (milliseconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(Date.now() + ms)
    .setJti(id)
    .setIssuer(issuer)
    .setAudience('brer.io/api')
    .setSubject(username)
    .sign(JWT_SECRET)

  return {
    id,
    issuer,
    raw,
    subject: '',
  }
}

/**
 * Resolves with JWT subject (`invocationId` or `username`).
 */
export async function verifyToken(
  raw: string,
  audience: string,
  issuer: string | string[] = ['brer.io/api', 'brer.io/invoker'],
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
