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

await writeKey(privateKey, args['private-key'], 'brer.ppk')

await writeKey(publicKey, args['public-key'], 'brer.pub')

async function writeKey(key, filename, fallback) {
  if (typeof filename !== 'string') {
    filename = fallback
  }
  try {
    await writeFile(filename, key, { flag: 'wx' })
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.error(`File ${filename} already exist`)
      process.exit(1)
    } else {
      return Promise.reject(err)
    }
  }
}
