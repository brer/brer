import type { RouteOptions } from '@brer/fastify'
import S from 'fluent-json-schema-es'

import { basicAuthorization } from '../lib/header.js'
import {
  signRegistryAccessToken,
  signRegistryRefreshToken,
} from '../lib/token.js'
import { authenticate } from './request.js'

export interface RouteGeneric {
  Body: {
    grant_type: 'password' | 'refresh_token'
    service: string
    client_id: string
    access_type?: 'offline' | 'online'
    scope?: string
    refresh_token?: string
    username?: string
    password?: string
  }
}

export default (): RouteOptions<RouteGeneric> => ({
  method: 'POST',
  url: '/v2/token',
  config: {
    public: true,
  },
  schema: {
    body: S.object()
      .prop('grant_type', S.string().enum(['password', 'refresh_token']))
      .required()
      .prop('service', S.string())
      .required()
      .prop('client_id', S.string())
      .required()
      .prop('access_type', S.string().enum(['offline', 'online']))
      .prop('scope', S.string())
      .prop('refresh_token', S.string())
      .prop('username', S.string())
      .prop('password', S.string()),
    response: {
      200: S.object()
        .prop('access_token', S.string())
        .description(
          'An opaque Bearer token that clients should supply to subsequent requests in the Authorization header.',
        )
        .required()
        .prop('scope', S.string())
        .description(
          'The scope granted inside the access token. This may be the same scope as requested or a subset.',
        )
        .required()
        .prop('expires_in', S.integer())
        .description(
          'The duration in seconds since the token was issued that it will remain valid.',
        )
        .required()
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
  async handler(request, reply) {
    const { body } = request

    if (body.service !== 'brer.io') {
      return reply.code(400).error({ message: 'Unsupported service.' })
    }

    const result = await authenticate(
      this,
      body.grant_type === 'password'
        ? basicAuthorization(body.username, body.password)
        : `Bearer ${body.refresh_token}`,
    )
    if (result.isErr) {
      return reply.code(401).error(result.unwrapErr())
    }

    const username = result.unwrap()
    const accessToken = await signRegistryAccessToken(
      username,
      getRepository(body.scope),
    )

    let refreshToken: string | undefined
    if (body.access_type === 'offline') {
      if (body.grant_type === 'refresh_token') {
        refreshToken = body.refresh_token
      } else {
        const obj = await signRegistryRefreshToken(username)
        refreshToken = obj.raw
      }
    }

    return {
      access_token: accessToken.raw,
      scope: body.scope,
      expires_in: accessToken.expiresIn,
      issued_at: accessToken.issuedAt.toISOString(),
      refresh_token: refreshToken,
    }
  },
})

function getRepository(scope: string = ''): string | undefined {
  const groups = scope.match(/^repository:([^:]+)/)
  if (groups) {
    return groups[1]
  }
}
