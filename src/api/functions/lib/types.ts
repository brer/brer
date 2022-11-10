import type { CouchDocument } from '../../../lib/store.js'

export interface Fn extends CouchDocument {
  /**
   * The name of this function (param case).
   */
  name: string
  /**
   * Docker image url.
   */
  image: string
  /**
   * Environment variables (value or secret).
   */
  env: FnEnv[]
}

// export enum FnStatus {
//   Verifying = 'verifying',
//   Ready = 'ready',
//   Rejected = 'rejected',
// }

export interface FnEnv {
  name: string
  value: string
}
