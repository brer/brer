import { createHmac } from 'node:crypto'
import * as uuid from 'uuid'

const secret = process.env.TOKEN_SECRET || '4YJA5J2vgORe9Bb2jqcRC5ImIdqYaLDl'

function getSignature(id: string) {
  return createHmac('sha256', secret).update(id).digest()
}

export function encodeToken(id: string) {
  const payload = Buffer.from(uuid.parse(id) as any)
  const signature = getSignature(id)
  return Buffer.concat([payload, signature]).toString('base64')
}

export function decodeToken(token: string) {
  const buffer = Buffer.from(token, 'base64')
  const id = uuid.stringify(buffer)
  const signature = getSignature(id)
  return signature.compare(buffer.subarray(16)) === 0 ? id : false
}
