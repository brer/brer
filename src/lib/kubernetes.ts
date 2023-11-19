import type { Invocation } from '@brer/invocation'
import type { V1EnvVar, V1Pod } from '@kubernetes/client-node'
import { randomBytes } from 'node:crypto'

import { getFunctionSecretName } from './function.js'
import { serializeImage } from './image.js'

export type WatchPhase = 'ADDED' | 'MODIFIED' | 'DELETED'

export type PodStatus =
  | 'Pending'
  | 'Running'
  | 'Succeeded'
  | 'Failed'
  | 'Unknown'

export function getPodStatus(pod: V1Pod): PodStatus {
  return (pod.status?.phase as PodStatus) || 'Unknown'
}

function getSuffix(): string {
  return randomBytes(4).readUInt32LE().toString(36)
}

const labelNames = {
  functionName: 'brer.io/function-name',
  invocationId: 'brer.io/invocation-id',
  managedBy: 'app.kubernetes.io/managed-by',
  project: 'brer.io/project',
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

  const defaultSecretName = getFunctionSecretName(invocation.functionName)
  for (const item of invocation.env) {
    env.push(
      item.secretKey
        ? {
            name: item.name,
            valueFrom: {
              secretKeyRef: {
                name: item.secretName || defaultSecretName,
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
        [labelNames.functionName]: invocation.functionName,
        [labelNames.project]: invocation.project,
        [labelNames.invocationId]: invocation._id,
        [labelNames.managedBy]: managedBy,
      },
    },
    spec: {
      automountServiceAccountToken: false,
      restartPolicy: 'Never',
      containers: [
        {
          name: 'job',
          image: serializeImage(invocation.image),
          imagePullPolicy: 'IfNotPresent',
          env,
          // TODO: make editable
          resources: {
            requests: {
              cpu: '10m',
              memory: '64Mi',
            },
            limits: {
              cpu: '500m',
              memory: '512Mi',
            },
          },
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
