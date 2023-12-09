import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { parseAuthorization } from '../lib/header.js'
import { asBoolean } from '../lib/qs.js'
import { REGISTRY_ISSUER, type SignedToken } from '../lib/token.js'
import { authenticate } from './request.js'

export interface RouteGeneric {
  Querystring: {
    service: string
    offline_token?: boolean
    client_id: string
    scope?: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'GET',
  url: '/v2/token',
  config: {
    public: true,
  },
  schema: {
    querystring: S.object()
      .prop('service', S.string())
      .required()
      .prop('offline_token', S.boolean().default(false))
      .prop('client_id', S.string())
      .required()
      .prop('scope', S.string()),
    response: {
      200: S.object()
        .prop('token', S.string())
        .deprecated()
        .required()
        .prop('access_token', S.string())
        .description(
          'An opaque Bearer token that clients should supply to subsequent requests in the Authorization header.',
        )
        .required()
        .prop('expires_in', S.integer())
        .description(
          'The duration in seconds since the token was issued that it will remain valid. When omitted, this defaults to 60 seconds. For compatibility with older clients, a token should never be returned with less than 60 seconds to live.',
        )
        .prop('issued_at', S.string().format('date-time'))
        .description(
          'The RFC3339-serialized UTC standard time at which a given token was issued. If issued_at is omitted, the expiration is from when the token exchange completed.',
        )
        .prop('refresh_token', S.string())
        .description(
          'Token which can be used to get additional access tokens for the same subject with different scopes. This token should be kept secure by the client and only sent to the authorization server which issues bearer tokens. This field will only be set when `offline_token=true` is provided in the request.',
        ),
    },
  },
  async preValidation(request) {
    request.log.warn({
      query: request.headers,
    })

    request.query.offline_token = asBoolean(request.query.offline_token)
  },
  async handler(request, reply) {
    const { log, query } = request

    if (query.service !== 'brer.io') {
      return reply.code(401).error({ message: 'Unsupported service.' })
    }

    const authorization = parseAuthorization(request.headers)
    if (!authorization) {
      return reply
        .code(401)
        .sendError({ message: 'Unsupported authorization scheme.' })
    }

    if (authorization.type === 'bearer') {
      try {
        await this.token.verifyToken(
          authorization.token,
          REGISTRY_ISSUER,
          REGISTRY_ISSUER,
        )
      } catch (err) {
        log.debug({ err }, 'invalid registry auth token')
        return reply.code(401).error()
      }
    }

    const result = await authenticate(this, authorization.raw)
    if (result.isErr) {
      return reply.code(401).error(result.unwrapErr())
    }

    const scope = query.scope || ''
    const username = result.unwrap()

    const accessToken = await this.token.signRegistryAccessToken(
      username,
      scope,
    )

    let refreshToken: SignedToken | undefined
    if (query.offline_token) {
      if (authorization.type === 'basic') {
        refreshToken = await this.token.signRegistryRefreshToken(username)
      } else {
        return reply
          .code(409)
          .error({ message: 'Refresh token expects basic authorization.' })
      }
    }

    return {
      token: accessToken.raw,
      access_token: accessToken.raw,
      expires_in: accessToken.expiresIn,
      issued_at: accessToken.issuedAt,
      refresh_token: refreshToken?.raw,
    }
  },
})
