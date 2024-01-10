import type { FastifyInstance } from '@brer/fastify'
import plugin from 'fastify-plugin'
import {
  errors as JoseErrors,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type KeyLike,
  SignJWT,
} from 'jose'
import { readFile } from 'node:fs/promises'
import { v4 as uuid } from 'uuid'

export const API_ISSUER = 'brer.io/api'
export const INVOKER_ISSUER = 'brer.io/invoker'
export const REGISTRY_ISSUER = 'brer.io/registry'

const ALG_ASYMMETHRIC = 'RS256'
const ALG_SYMMETHRIC = 'HS256'

export interface Token {
  id: string
  subject: string
  raw: string
  issuer: string
  repository?: string
}

async function verifyToken(
  jwt: string,
  key: KeyLike | Uint8Array,
  audience: string,
  issuer?: string | string[],
): Promise<Token> {
  const { payload } = await jwtVerify(jwt, key, {
    algorithms: [ALG_SYMMETHRIC, ALG_ASYMMETHRIC],
    issuer,
    audience,
  })
  return {
    id: payload.jti || uuid(),
    issuer: payload.iss || '',
    raw: jwt,
    subject: payload.sub || '',
    repository: typeof payload.rep === 'string' ? payload.rep : undefined,
  }
}

function getAlgorithm(key: KeyLike | Uint8Array) {
  return Symbol.iterator in key ? ALG_SYMMETHRIC : ALG_ASYMMETHRIC
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

/**
 * Returns seconds since UNIX epoch.
 */
function getExpirationTime(date: Date, seconds: number) {
  return Math.floor(date.getTime() / 1000) + seconds
}

async function signApiToken(
  key: KeyLike | Uint8Array,
  username: string,
): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()
  const expiresIn = 900 // 15 minutes (seconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: getAlgorithm(key) })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(API_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(username)
    .sign(key)

  return {
    expiresIn,
    id,
    issuedAt,
    issuer: API_ISSUER,
    raw,
    subject: username,
  }
}

async function signInvocationToken(
  key: KeyLike | Uint8Array,
  invocationId: string,
  expiresIn: number,
): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: getAlgorithm(key) })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(INVOKER_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER])
    .setSubject(invocationId)
    .sign(key)

  return {
    expiresIn,
    id,
    issuedAt,
    issuer: INVOKER_ISSUER,
    raw,
    subject: invocationId,
  }
}

async function signRegistryRefreshToken(
  key: KeyLike | Uint8Array,
  username: string,
): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()
  const expiresIn = 15724800 // 6 months (seconds)

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: getAlgorithm(key) })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(REGISTRY_ISSUER)
    .setAudience(REGISTRY_ISSUER)
    .setSubject(username)
    .sign(key)

  return {
    expiresIn,
    id,
    issuedAt,
    issuer: REGISTRY_ISSUER,
    raw,
    subject: username,
  }
}

async function signRegistryAccessToken(
  key: KeyLike | Uint8Array,
  username: string,
  repository: string | undefined,
): Promise<SignedToken> {
  const id = uuid()
  const issuedAt = new Date()
  const expiresIn = 300 // 5 minutes (seconds)

  const raw = await new SignJWT({ rep: repository })
    .setProtectedHeader({ alg: getAlgorithm(key) })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setJti(id)
    .setIssuer(REGISTRY_ISSUER)
    .setAudience([API_ISSUER, INVOKER_ISSUER, REGISTRY_ISSUER])
    .setSubject(username)
    .sign(key)

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

declare module 'fastify' {
  interface FastifyInstance {
    token: {
      signApiToken(username: string): Promise<SignedToken>
      signInvocationToken(
        invocationId: string,
        expiresIn: number,
      ): Promise<SignedToken>
      signRegistryRefreshToken(username: string): Promise<SignedToken>
      signRegistryAccessToken(
        username: string,
        repository: string | undefined,
      ): Promise<SignedToken>
      verifyToken(
        raw: string,
        audience: string,
        issuer?: string | string[],
      ): Promise<Token>
    }
  }
}

export interface PluginOptions {
  /**
   * Symmetric secret.
   */
  secret?: string
  /**
   * PKCS8 PEM filepath.
   */
  privateKey?: string
  /**
   * SPKI PEM filepath.
   */
  publicKeys?: string[]
}

async function tokenPlugin(fastify: FastifyInstance, options: PluginOptions) {
  const { privateKey, publicKeys } = await createKeys(options)

  const decorator: FastifyInstance['token'] = {
    signApiToken(username) {
      return signApiToken(privateKey, username)
    },
    signInvocationToken(invocationId, expiresIn) {
      return signInvocationToken(privateKey, invocationId, expiresIn)
    },
    signRegistryAccessToken(username, repository) {
      return signRegistryAccessToken(privateKey, username, repository)
    },
    signRegistryRefreshToken(username) {
      return signRegistryRefreshToken(privateKey, username)
    },
    async verifyToken(
      jwt: string,
      audience: string,
      issuer?: string | string[],
    ) {
      for (const key of publicKeys) {
        try {
          return await verifyToken(jwt, key, audience, issuer)
        } catch (err) {
          if (!(err instanceof JoseErrors.JWSSignatureVerificationFailed)) {
            return Promise.reject(err)
          }
        }
      }
      throw new Error('Foreign token detected')
    },
  }

  fastify.decorate('token', decorator)
}

interface FastifyKeys {
  privateKey: KeyLike | Uint8Array
  publicKeys: Array<KeyLike | Uint8Array>
}

async function createKeys(options: PluginOptions): Promise<FastifyKeys> {
  if (options.privateKey) {
    if (!options.publicKeys?.length) {
      throw new Error('Public key is missing')
    }

    const privateKey = await importPKCS8(
      await readFile(options.privateKey, 'utf-8'),
      ALG_ASYMMETHRIC,
    )
    const publicKeys: Array<KeyLike | Uint8Array> = await Promise.all(
      options.publicKeys.map(file =>
        readFile(file, 'utf-8').then(key => importSPKI(key, ALG_ASYMMETHRIC)),
      ),
    )
    if (options.secret) {
      publicKeys.push(Buffer.from(options.secret))
    }

    return { privateKey, publicKeys }
  } else if (options.secret) {
    const key = Buffer.from(options.secret)

    return {
      privateKey: key,
      publicKeys: [key],
    }
  } else {
    throw new Error('Specify JWT secret or certificate')
  }
}

export default plugin(tokenPlugin, {
  name: 'token',
})
