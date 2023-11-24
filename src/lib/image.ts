export interface ContainerImage {
  /**
   * Host (no protocol, no auth, no path).
   * https://nodejs.org/api/url.html#url-strings-and-url-objects
   */
  host: string
  /**
   * The name of the Docker image.
   * The maximum length is 4096 characters.
   * Valid values: Any alphanumeric characters from 0 to 9, A to Z, a to z,
   * and the _ and - characters.
   */
  name: string
  /**
   * The tag must be valid ASCII and can contain lowercase and uppercase
   * letters, digits, underscores, periods, and hyphens.
   * It cannot start with a period or hyphen and must be no longer than
   * 128 characters.
   */
  tag: string
}

// TODO: improve
export const IMAGE_HOST_REGEXP = /^[a-zA-Z0-9:\.\-]+$/

export const IMAGE_NAME_REGEXP = /^[a-zA-Z0-9_\-]+$/

export const IMAGE_TAG_REGEXP = /^[a-zA-Z0-9_][a-zA-Z0-9_\.]*$/

export const IMAGE_PATH_REGEXP =
  /^([a-zA-Z0-9:\.\-]+)\/([a-zA-Z0-9_\-]+):([a-zA-Z0-9_][a-zA-Z0-9_.\-]*)$/

export function parseImagePath(image: string): ContainerImage | undefined {
  const result = image.match(IMAGE_PATH_REGEXP)
  if (result) {
    return {
      host: result[1],
      name: result[2],
      tag: result[3],
    }
  }
}

/**
 * Treats "latest" tags as _never_ the same image.
 */
export function isSameImage(a: ContainerImage, b: ContainerImage): boolean {
  return (
    a.host === b.host &&
    a.name === b.name &&
    a.tag === b.tag &&
    a.tag !== 'latest'
  )
}

/**
 * TODO: avoid using envs here
 */
export function serializeImage(image: ContainerImage): string {
  let host = image.host
  if (process.env.PUBLIC_URL && process.env.REGISTRY_URL) {
    const publicUrl = new URL(process.env.PUBLIC_URL)
    const registryUrl = new URL(process.env.REGISTRY_URL)
    if (host === publicUrl.host) {
      host = registryUrl.host
    }
  }
  return `${host}/${image.name}:${image.tag}`
}
