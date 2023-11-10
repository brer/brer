import type * as fastify from 'fastify'
import type { JSONSchema } from 'fluent-json-schema-es'
import type * as http from 'node:http'

export type RawServer = http.Server

export type RawRequest = http.IncomingMessage

export type RawReply = http.ServerResponse

export interface FastifyContext {
  /**
   * Disable (bypass) the auth middleware for the current route.
   */
  public?: boolean
}

export interface FastifySchema extends fastify.FastifySchema {
  body?: JSONSchema
  querystring?: JSONSchema
  params?: JSONSchema
  headers?: JSONSchema
  response?: Record<string, JSONSchema>
}

export type FastifyLogger = fastify.FastifyBaseLogger

export type FastifyInstance = fastify.FastifyInstance<
  RawServer,
  RawRequest,
  RawReply
>

export type FastifyReply = fastify.FastifyReply<
  RawServer,
  RawRequest,
  RawReply,
  {},
  FastifyContext,
  FastifySchema,
  fastify.FastifyTypeProviderDefault,
  {}
>

export type FastifyRequest<G extends RouteGeneric = RouteGeneric> =
  fastify.FastifyRequest<
    G,
    RawServer,
    RawRequest,
    FastifySchema,
    fastify.FastifyTypeProviderDefault,
    FastifyContext,
    FastifyLogger,
    {
      body: G['Body']
      headers: G['Headers']
      params: G['Params']
      query: G['Querystring']
    }
  >

export type RouteOptions<G extends RouteGeneric = RouteGeneric> =
  fastify.RouteOptions<
    RawServer,
    RawRequest,
    RawReply,
    G,
    FastifyContext,
    FastifySchema,
    fastify.FastifyTypeProviderDefault,
    FastifyLogger
  >

export interface RouteGeneric {
  Body?: unknown
  Headers?: Record<string, unknown>
  Params?: Record<string, unknown>
  Querystring?: Record<string, unknown>
}
