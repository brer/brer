import { pbkdf2, randomBytes } from 'node:crypto'

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(8)
  const entity = await createEntity(0, salt, secret)
  return serializeEntity(entity)
}

export async function verifySecret(
  secret: string,
  hash: string,
): Promise<boolean> {
  const reference = parseEntity(hash)
  const result = await createEntity(reference.version, reference.salt, secret)
  return result.hash.equals(reference.hash)
}

interface HashEntity {
  hash: Buffer
  salt: Buffer
  version: number
}

async function createEntity(
  version: number,
  salt: Buffer,
  secret: string,
): Promise<HashEntity> {
  return new Promise((resolve, reject) => {
    if (version !== 0) {
      return reject(new Error(`Usupported hash type: ${version}`))
    }
    pbkdf2(secret, salt, 10101, 32, 'sha512', (err, hash) => {
      if (err) {
        reject(err)
      } else {
        resolve({ hash, salt, version })
      }
    })
  })
}

const HASH_REGEX = /^\$([0-9])\$([0-9a-f]+)\$([0-9a-f]+)$/

function parseEntity(value: string): HashEntity {
  const match = value.match(HASH_REGEX)
  if (!match) {
    throw new Error('Expected entity hash')
  }
  return {
    hash: Buffer.from(match[3], 'hex'),
    salt: Buffer.from(match[2], 'hex'),
    version: parseInt(match[1]),
  }
}

function serializeEntity({ hash, salt, version }: HashEntity): string {
  return `$${version}$${salt.toString('hex')}$${hash.toString('hex')}`
}
