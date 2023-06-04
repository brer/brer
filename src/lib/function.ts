import type { FnEnv } from '@brer/types'
import * as uuid from 'uuid'

const namespace =
  process.env.UUID_NAMESPACE || 'f71b108f-2005-4269-be6f-e83005040874'

export function getDefaultSecretName(functionName: string) {
  return `fn-${functionName}`
}

export function purgeSecrets(env: FnEnv[]): FnEnv[] {
  return env.map(item =>
    item.secretKey
      ? {
          name: item.name,
          secretKey: item.secretKey,
        }
      : {
          name: item.name,
          value: item.value,
        },
  )
}

export function getFunctionId(functionName: string) {
  return uuid.v5(functionName, namespace)
}
