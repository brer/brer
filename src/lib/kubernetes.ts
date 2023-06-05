import type { Invocation } from '@brer/types'
import {
  KubeConfig,
  Log,
  LogOptions,
  V1EnvVar,
  V1Pod,
} from '@kubernetes/client-node'
import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'node:crypto'
import { PassThrough } from 'node:stream'

import { getDefaultSecretName } from './function.js'

export type PodStatus =
  | 'Pending'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Unknown'

export function getPodStatus(pod: V1Pod): PodStatus {
  return (pod.status?.phase as PodStatus) || 'Unknown'
}

export type ContainerStatus = 'waiting' | 'running' | 'terminated' | 'unknown'

export function getContainerStatus(pod: V1Pod): ContainerStatus {
  const status = pod.status?.containerStatuses?.[0]
  if (status?.state?.terminated) {
    return 'terminated'
  } else if (status?.state?.running) {
    return 'running'
  } else if (status?.state?.waiting) {
    return 'waiting'
  } else {
    return 'unknown'
  }
}

export function isPodDead(pod: V1Pod) {
  const podStatus = getPodStatus(pod)
  return podStatus === 'Succeeded' || podStatus === 'Failed'
}

export async function* downloadPodLogs(
  config: KubeConfig,
  namespace: string,
  pod: string,
  container: string,
  options?: LogOptions,
): AsyncGenerator<Buffer> {
  const log = new Log(config)
  const stream = new PassThrough({ decodeStrings: true })

  try {
    // TODO: abort this request?
    await log.log(namespace, pod, container, stream, options)
  } catch (err) {
    if (Object(Object(err).response).statusCode === 404) {
      // pod was deleted, ignore the error
      return
    } else {
      throw err
    }
  }

  for await (const buffer of stream) {
    yield buffer
  }
}

function getSuffix(): string {
  return randomBytes(4).readUInt32LE().toString(36)
}

const labelNames = {
  functionName: 'brer.io/function-name',
  invocationId: 'brer.io/invocation-id',
  managedBy: 'app.kubernetes.io/managed-by',
}

const managedBy = 'brer.io'

export function getPodTemplate(
  invocation: Invocation,
  url: string,
  token: string,
): V1Pod {
  const env: V1EnvVar[] = [
    { name: 'BRER_URL', value: url },
    { name: 'BRER_TOKEN', value: token },
  ]

  const secretName =
    invocation.secretName || getDefaultSecretName(invocation.functionName)

  for (const item of invocation.env) {
    env.push(
      item.secretKey
        ? {
            name: item.name,
            valueFrom: {
              secretKeyRef: {
                name: secretName,
                key: item.secretKey,
              },
            },
          }
        : {
            name: item.name,
            value: item.value,
          },
    )
  }

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: `fn-${invocation.functionName}-${getSuffix()}`,
      labels: {
        [labelNames.managedBy]: managedBy,
        [labelNames.functionName]: invocation.functionName,
        [labelNames.invocationId]: invocation._id!,
      },
    },
    spec: {
      automountServiceAccountToken: false,
      restartPolicy: 'Never',
      containers: [
        {
          name: 'job',
          image: invocation.image,
          imagePullPolicy: 'IfNotPresent',
          env,
          // TODO: resources?
          // resources: {
          //   requests: {
          //     cpu: '10m',
          //     memory: '64Mi',
          //   },
          //   limits: {
          //     cpu: '1000m',
          //     memory: '1024Mi',
          //   },
          // },
        },
      ],
    },
  }
}

export interface Filters {
  functionName?: string | string[]
  invocationId?: string | string[]
}

export function getLabelSelector(filters: Filters = {}): string {
  const selectors = [serializeLabelSelector(labelNames.managedBy, managedBy)]
  if (filters.invocationId !== undefined) {
    selectors.push(
      serializeLabelSelector(labelNames.invocationId, filters.invocationId),
    )
  }
  if (filters.functionName !== undefined) {
    selectors.push(
      serializeLabelSelector(labelNames.functionName, filters.functionName),
    )
  }
  return selectors.join(',')
}

function serializeLabelSelector(key: string, value: string | string[]): string {
  // TODO: escape?
  if (Array.isArray(value)) {
    if (value.length > 1) {
      return `${key} in (${value.join(', ')})`
    } else if (value.length === 1) {
      return `${key}=${value[0]}`
    } else {
      throw new Error('Array selectors must contain at least one value')
    }
  } else {
    if (!value.trim()) {
      throw new Error('Empty strings are not valid selectors')
    }
    return `${key}=${value}`
  }
}

export async function getPodByInvocationId(
  kubernetes: FastifyInstance['kubernetes'],
  invocationId: string,
): Promise<V1Pod | null> {
  const result = await kubernetes.api.CoreV1Api.listNamespacedPod(
    kubernetes.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    getLabelSelector({ invocationId }),
    1,
  )
  return result.body.items[0] || null
}

export async function findPodByName(
  kubernetes: FastifyInstance['kubernetes'],
  podName: string,
  namespace?: string,
): Promise<V1Pod | null> {
  const result = await kubernetes.api.CoreV1Api.listNamespacedPod(
    namespace || kubernetes.namespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${podName}`,
    undefined,
    1,
  )
  return result.body.items[0] || null
}
