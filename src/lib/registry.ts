import got, { Got } from 'got'

let CLIENT: Got | undefined

export function getRegistryClient() {
  if (!CLIENT) {
    if (!process.env.REGISTRY_URL) {
      throw new Error('Env var REGISTRY_URL not defined')
    }
    CLIENT = got.extend({
      password: process.env.REGISTRY_PASSWORD,
      prefixUrl: process.env.REGISTRY_URL,
      responseType: 'buffer',
      username: process.env.REGISTRY_USERNAME,
    })
  }
  return CLIENT
}

export interface DockerUrl {
  hostname: string
  repository: string
  tag: string
}

export function parseDockerUrl(image: string): DockerUrl | undefined {
  const result = image.match(/^([^\/]+)\/([^:]+):(.+)$/)
  if (result) {
    return {
      hostname: result[1],
      repository: result[2],
      tag: result[3],
    }
  }
}
