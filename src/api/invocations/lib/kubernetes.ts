import type { Invocation } from '@brer/types'
import type { V1Pod } from '@kubernetes/client-node'
import type { FastifyInstance } from 'fastify'

function getDateSuffix(): string {
  return Math.round(Date.now() / 1000).toString(16)
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
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: `fn-${invocation.functionName}-${getDateSuffix()}`,
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
          env: [
            { name: 'BRER_URL', value: url },
            { name: 'BRER_TOKEN', value: token },
            { name: 'BRER_INVOCATION_ID', value: invocation._id },
            ...invocation.env,
          ],
          // TODO: secrets?
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

export function getLabelSelector(filters: Filters): string {
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
  if (selectors.length <= 1) {
    // Prevent slow actions
    throw new Error('Expected at least one filter')
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
