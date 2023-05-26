import type { FnEnv } from '@brer/types'

export function getDefaultSecretName(functionName: string) {
  return `fn-${functionName}`
}

export function purgeSecrets(env: FnEnv[]): FnEnv[] {
  return env.map(item => ({
    ...item,
    value: item.secretKey ? '' : item.value,
  }))
}
