import { createHmac, randomBytes } from 'node:crypto'
import * as uuid from 'uuid'

/**
 * Node.js (this) process random signature.
 */
const randomness = randomBytes(4)

/**
 * HMAC signature secret.
 */
const secret = process.env.HMAC_SECRET || '4YJA5J2vgORe9Bb2jqcRC5ImIdqYaLDl'

export interface InvocationToken {
  /**
   * Invocation identifier.
   */
  id: string
  /**
   * Token creation date.
   */
  date: Date
  /**
   * Token signature.
   */
  signature: string
  /**
   * Raw base64 token string.
   */
  value: string
}

/**
 * Returns a 56 bytes long base64 encoded token string.
 */
export function encodeToken(id: string): InvocationToken {
  const date = new Date()

  const chunks = [
    // 4 bytes (seconds since unix epoch)
    Buffer.alloc(4),
    // 4 bytes process unique identifier
    randomness,
    // 16 bytes (binary uuid)
    Buffer.from(uuid.parse(id)),
  ]

  chunks[0].writeUInt32LE(Math.round(date.getTime() / 1000))

  const signature = getSignature(Buffer.concat(chunks))

  return {
    date,
    id,
    signature: signature.toString('base64'),
    value: Buffer.concat([...chunks, signature]).toString('base64'),
  }
}

export function decodeToken(token: string): InvocationToken | false {
  const buffer = Buffer.from(token, 'base64')
  if (buffer.byteLength === 56) {
    const signature = getSignature(buffer.subarray(0, 24))
    if (signature.compare(buffer.subarray(24)) === 0) {
      return {
        date: new Date(buffer.readUint32LE() * 1000),
        id: uuid.stringify(buffer, 8),
        signature: signature.toString('base64'),
        value: token,
      }
    }
  }
  return false
}

/**
 * Returns a 32 bytes long buffer.
 */
export function getSignature(data: Buffer) {
  return createHmac('sha256', secret).update(data).digest()
}
