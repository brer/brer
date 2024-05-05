import type { FastifyInstance } from '@brer/fastify'
import type { Invocation } from '@brer/invocation'
import type { V1EnvVar, V1Pod } from '@kubernetes/client-node'

import { getFunctionByName, getFunctionSecretName } from '../lib/function.js'
import { serializeImage } from '../lib/image.js'
import { failInvocation, handleInvocation } from '../lib/invocation.js'
import { isOlderThan } from '../lib/util.js'

/**
 * Finalizer used to prevent Pod's deletion.
 */
const FINALIZER = 'brer.io/invocation-protection'

/**
 * Reconcile by Invocation identifier.
 */
export async function reconcileByInvocationId(
  fastify: FastifyInstance,
  invokerUrl: URL,
  invocationId: string,
): Promise<void> {
  const { store } = fastify

  const invocation = await store.invocations.find(invocationId).unwrap()
  if (invocation) {
    await reconcileInvocation(fastify, invokerUrl, invocation)
  } else {
    await purgePods(fastify, invocationId)
  }
}

/**
 * Handle watch event from Kubernetes watch-list request.
 */
export function getPodInvocationId(pod: V1Pod): string | undefined {
  if (pod.metadata!.labels?.['app.kubernetes.io/managed-by'] === 'brer.io') {
    return pod.metadata!.labels?.['brer.io/invocation-id']
  }
}

/**
 * Main (internal) Invocation reconciliation handler.
 */
async function reconcileInvocation(
  fastify: FastifyInstance,
  invokerUrl: URL,
  invocation: Invocation,
): Promise<void> {
  const { events, kubernetes, store, tokens } = fastify
  const log = fastify.log.child({ invocationId: invocation._id })

  if (invocation.status === 'failed' && shouldRestartInvocation(invocation)) {
    log.debug('retry invocation')
    return reconcileInvocation(
      fastify,
      invokerUrl,
      await store.invocations
        .from(invocation)
        .update(handleInvocation)
        .unwrap(),
    )
  }

  if (invocation.status === 'completed' || invocation.status === 'failed') {
    // Handle dead Invocation.
    // Perform all finalizing tasks, and then purge all Pods.

    if (invocation.runtimeTest) {
      await setFunctionRuntime(fastify, invocation)
    }

    await rotateInvocations(fastify, invocation.functionName)

    events.emit('brer.io/invocations/died', invocation._id)

    await purgePods(fastify, invocation._id)

    return
  }

  if (invocation.status === 'pending') {
    const ids = await getActiveInvocationIds(fastify)
    if (!ids.includes(invocation._id)) {
      log.trace('invocation is queued')
      return
    }

    log.debug('initialize invocation')
    return reconcileInvocation(
      fastify,
      invokerUrl,
      await store.invocations
        .from(invocation)
        .update(handleInvocation)
        .unwrap(),
    )
  }

  if (invocation.status === 'initializing' && hasTimedOut(invocation)) {
    log.debug('invocation timed out')
    return reconcileInvocation(
      fastify,
      invokerUrl,
      await store.invocations
        .from(invocation)
        .update(doc => failInvocation(doc, 'timed out'))
        .unwrap(),
    )
  }

  const pod = await getInvocationPod(fastify, invocation)

  if (!pod) {
    if (invocation.status === 'initializing') {
      log.debug('spawn invocation')
      const expiresIn = 86400 // 24 hours (seconds)
      const token = await tokens.signInvocationToken(invocation._id, expiresIn)

      await kubernetes.api.CoreV1Api.createNamespacedPod(
        kubernetes.namespace,
        getPodTemplate(invokerUrl, invocation, token.raw),
      )
    } else {
      log.debug('forced pod deletion')
      await reconcileInvocation(
        fastify,
        invokerUrl,
        await store.invocations
          .from(invocation)
          .update(doc => failInvocation(doc, 'forced pod deletion'))
          .unwrap(),
      )
    }
    return
  }

  if (isPodRunning(pod)) {
    log.trace('invocation is still running')
    return
  }

  const reason = pod.metadata?.deletionTimestamp
    ? 'manual pod deletion'
    : 'runtime failure'

  log.debug(reason)
  return reconcileInvocation(
    fastify,
    invokerUrl,
    await store.invocations
      .from(invocation)
      .update(doc => failInvocation(doc, reason))
      .unwrap(),
  )
}

/**
 * Purge all Invocation's Pods from the cluster (also remove the finalizer).
 */
async function purgePods(fastify: FastifyInstance, invocationId: string) {
  const { kubernetes } = fastify

  const response = await kubernetes.api.CoreV1Api.listNamespacedPod(
    kubernetes.namespace,
    undefined,
    undefined,
    undefined,
    undefined,
    `brer.io/invocation-id=${invocationId}`,
  )

  await Promise.all(response.body.items.map(p => purgePod(fastify, p)))
}

/**
 * Purge Pod from the cluster.
 */
async function purgePod({ kubernetes, log }: FastifyInstance, pod: V1Pod) {
  const index = pod.metadata?.finalizers?.findIndex(f => f === FINALIZER) ?? -1

  if (index >= 0) {
    const path = `/metadata/finalizers/${index}`

    log.debug({ podName: pod.metadata!.name! }, 'pull finalizer')
    await kubernetes.api.CoreV1Api.patchNamespacedPod(
      pod.metadata!.name!,
      kubernetes.namespace,
      [
        { op: 'test', path, value: FINALIZER },
        { op: 'remove', path },
      ],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        headers: {
          'Content-Type': 'application/json-patch+json',
        },
      },
    )
  }

  if (!pod.metadata?.deletionTimestamp) {
    log.debug({ podName: pod.metadata!.name! }, 'delete pod')
    await kubernetes.api.CoreV1Api.deleteNamespacedPod(
      pod.metadata!.name!,
      kubernetes.namespace,
    )
  }
}

/**
 * Get the actual Pod name for the current execution.
 */
function getInvocationPodName(invocation: Invocation): string | undefined {
  if (invocation.status === 'initializing' || invocation.status === 'running') {
    let failures = 0
    for (const phase of invocation.phases) {
      if (phase.status === 'failed') {
        failures++
      }
    }
    return `fn-${invocation.functionName}-${invocation.suffix}${failures.toString(16).padStart(2, '0')}`
  }
}

/**
 * Retrieves the currently active Invocation's Pod.
 */
async function getInvocationPod(
  fastify: FastifyInstance,
  invocation: Invocation,
): Promise<V1Pod | null> {
  const { kubernetes } = fastify
  const podName = getInvocationPodName(invocation)
  if (!podName) {
    return null
  }

  try {
    const response = await kubernetes.api.CoreV1Api.readNamespacedPod(
      podName,
      kubernetes.namespace,
    )
    return response.body
  } catch (err) {
    if (Object(err).statusCode === 404) {
      return null
    } else {
      return Promise.reject(err)
    }
  }
}

/**
 * Returns `true` when the Pod is still running (or in an unknown status).
 */
function isPodRunning(pod: V1Pod): boolean {
  return (
    !pod.metadata?.deletionTimestamp &&
    pod.status?.phase !== 'Succeeded' &&
    pod.status?.phase !== 'Failed'
  )
}

/**
 * Invocation stuck in `initializing` phase for more than 10 minutes.
 */
function hasTimedOut(invocation: Invocation): boolean {
  return (
    invocation.status === 'initializing' &&
    isOlderThan(invocation.phases[invocation.phases.length - 1].date, 600)
  )
}

/**
 * Returns `true` when a failed Invocation should be restarted.
 */
function shouldRestartInvocation(invocation: Invocation): boolean {
  if (
    !invocation.runtimeTest &&
    invocation.status === 'failed' &&
    invocation.retries &&
    invocation.reason !== 'timed out'
  ) {
    const failures = invocation.phases.reduce(
      (n, p) => (p.status === 'failed' ? n : n + 1),
      0,
    )
    return invocation.retries >= failures
  }
  return false
}

export async function getActiveInvocationIds({ store }: FastifyInstance) {
  const response = await store.invocations.adapter.scope.view(
    'default',
    'alive',
    {
      descending: true,
      limit: 10,
      sorted: true,
      include_docs: false,
    },
  )

  return response.rows.map(r => r.id)
}

function getPodTemplate(
  invokerUrl: URL,
  invocation: Invocation,
  token: string,
): V1Pod {
  const env: V1EnvVar[] = [
    { name: 'BRER_URL', value: invokerUrl.href },
    { name: 'BRER_TOKEN', value: token },
    { name: 'BRER_INVOCATION_ID', value: invocation._id },
  ]
  if (invocation.runtimeTest) {
    env.push({ name: 'BRER_MODE', value: 'test' })
  }

  const functionSecret = getFunctionSecretName(invocation.functionName)
  for (const item of invocation.env) {
    env.push(
      item.secretKey
        ? {
            name: item.name,
            valueFrom: {
              secretKeyRef: {
                name: item.secretName || functionSecret,
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

  const cpuRequest =
    invocation.resources?.requests?.cpu || process.env.K8S_CPU_REQUEST

  const memoryRequest =
    invocation.resources?.requests?.memory || process.env.K8S_MEMORY_REQUEST

  const cpuLimit =
    invocation.resources?.limits?.cpu || process.env.K8S_CPU_LIMIT

  const memoryLimit =
    invocation.resources?.limits?.memory || process.env.K8S_MEMORY_LIMIT

  // TODO: ugly
  const resources: any = {}
  if (cpuRequest || memoryRequest) {
    resources.request = {}
    if (cpuRequest) {
      resources.request.cpu = cpuRequest
    }
    if (memoryRequest) {
      resources.request.memory = memoryRequest
    }
  }
  if (cpuLimit || memoryLimit) {
    resources.limit = {}
    if (cpuLimit) {
      resources.limit.cpu = cpuLimit
    }
    if (memoryLimit) {
      resources.limit.memory = memoryLimit
    }
  }

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      creationTimestamp: new Date(),
      name: getInvocationPodName(invocation),
      labels: {
        'app.kubernetes.io/managed-by': 'brer.io',
        'brer.io/function-name': invocation.functionName,
        'brer.io/invocation-id': invocation._id,
        'brer.io/project': invocation.project,
      },
      finalizers: [FINALIZER],
    },
    spec: {
      automountServiceAccountToken: false,
      restartPolicy: 'Never',
      containers: [
        {
          name: 'job',
          image: serializeImage(invocation.image),
          imagePullPolicy:
            invocation.image.tag === 'latest' ? 'Always' : 'IfNotPresent',
          env,
          resources,
        },
      ],
    },
  }
}

/**
 * Keep only the latest dead Invocations.
 */
async function rotateInvocations(
  { log, store }: FastifyInstance,
  functionName: string,
) {
  // TODO: do not make this request
  const fn = await getFunctionByName(store, functionName)

  await store.invocations
    .filter({
      _design: 'default',
      _view: 'history',
      startkey: [functionName, {}],
      endkey: [functionName, null],
    })
    .tap(i => log.debug({ invocationId: i._id }, 'purge invocation'))
    .delete()
    .unwrap({
      descending: true,
      purge: true,
      skip: fn ? fn.historyLimit || 10 : 0,
    })
}

/**
 * Make a API request to patch the Function's runtime.
 */
async function setFunctionRuntime(
  { log, pools, tokens }: FastifyInstance,
  invocation: Invocation,
) {
  const { functionName } = invocation
  const token = await tokens.signInvocationToken(invocation._id, 60) // 1 minute (seconds)

  log.debug({ functionName }, 'update function runtime')
  const response = await pools.get('api').request({
    method: 'PUT',
    path: `/api/v1/functions/${functionName}/runtime`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      image: invocation.image,
      runtime: getRuntime(invocation),
    }),
  })

  const data: any = await response.body.json()

  if (response.statusCode === 200) {
    log.trace({ functionName }, 'image runtime updated')
  } else if (response.statusCode === 404) {
    log.trace({ functionName }, 'function not found')
  } else if (response.statusCode === 422) {
    log.trace({ functionName }, 'function image mismatch')
  } else {
    log.error({ functionName, response: data }, 'runtime update failed')
  }
}

function getRuntime(invocation: Invocation): object {
  if (invocation.status !== 'completed') {
    return {
      type: 'Unknown',
      invocationId: invocation._id,
    }
  }

  const runtime: any = Object(Object(invocation.result).runtime)
  if (typeof runtime.type === 'string') {
    return runtime
  } else {
    return {
      type: 'Unknown',
      invocationId: invocation._id,
    }
  }
}
