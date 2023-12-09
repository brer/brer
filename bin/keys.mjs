#!/usr/bin/env node

import minimist from 'minimist'
import { generateKeyPairSync } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const args = minimist(process.argv.slice(2))

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 4096,
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
})

await writeFile(resolve(args['private-key'], 'brer.pub'), privateKey, {
  flag: 'wx',
})

await writeFile(resolve(args['public-key'], 'brer.ppk'), publicKey, {
  flag: 'wx',
})

function resolve(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback
}
