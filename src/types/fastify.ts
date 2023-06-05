import type * as fastify from 'fastify'
import type { JSONSchema } from 'fluent-json-schema-es'
import type * as http from 'http'

export type RawServer = http.Server

export type RawRequest = http.IncomingMessage

export type RawReply = http.ServerResponse

export interface FastifyContext {}

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

export type FastifyRequest<G extends RouteGeneric = RouteGenericDefault> =
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

export type RouteOptions<G extends RouteGeneric = RouteGenericDefault> =
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
  Body?: any
  Querystring?: Record<string, any>
  Params?: Record<string, any>
  Headers?: Record<string, any>
}

export interface RouteGenericDefault {
  Body: Record<string, any>
  Querystring: Record<string, any>
  Params: Record<string, any>
  Headers: Record<string, any>
}
