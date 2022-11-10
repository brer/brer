import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

const dir = path.join(tmpdir(), 'brer')

function getFilePath(invocationId: string) {
  return path.join(dir, `${invocationId}.bin`)
}

export async function writePayload(
  invocationId: string,
  payload: Buffer,
): Promise<void> {
  await fs.writeFile(getFilePath(invocationId), payload)
}

export async function readPayload(
  invocationId: string,
): Promise<Buffer | null> {
  const file = getFilePath(invocationId)
  try {
    await fs.access(path.join(dir, `${invocationId}.bin`))
  } catch (err) {
    return null
  }
  return fs.readFile(file)
}
