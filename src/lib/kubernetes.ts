import { KubeConfig, Watch } from '@kubernetes/client-node'
import Queue from 'fastq'

export interface WatchOptions {
  /**
   * @default 1
   */
  concurrency?: number
  kubeconfig: KubeConfig
  onEvent: (event: WatchEvent) => Promise<any>
  onError?: (err: any) => any
  onExit?: (err: any) => any
  path: string
  queryParams?: object
  signal?: AbortSignal
}

export interface WatchEvent<T = any> {
  phase: 'ADDED' | 'MODIFIED' | 'DELETED'
  resource: T
}

export async function watchResource(options: WatchOptions) {
  const {
    concurrency = 1,
    kubeconfig,
    onEvent,
    onError = noop,
    onExit = noop,
    path,
    queryParams = {},
    signal,
  } = options

  const queue = Queue.promise(onEvent, concurrency)
  const watcher = new Watch(kubeconfig)

  let request: any

  const exit = once((err: any) => {
    if (request) {
      request.destroy(err)
    }
    queue.kill()
    onExit(err)
  })

  request = await watcher.watch(
    path,
    queryParams,
    (phase: any, resource) => {
      queue.push({ phase, resource }).catch(onError)
    },
    exit,
  )

  if (signal) {
    signal.addEventListener('abort', () => exit(signal.reason))
  }

  return exit
}

function noop() {
  // nothing to do
}

function once<T>(fn: (arg: T) => any): (arg: T) => void {
  return arg => {
    fn(arg)
    fn = noop
  }
}
