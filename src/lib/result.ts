/**
 * Mimics the Rust `Result`.
 * https://doc.rust-lang.org/std/result/
 */
export interface Result<O, E> {
  readonly isOk: boolean
  readonly isErr: boolean
  andThen<A, B>(fn: (val: O) => Result<A, B>): Result<A, B | E>
  orElse<A, B>(fn: (err: E) => Result<A, B>): Result<A | O, B>
  map<T>(fn: (val: O) => T): Result<T, E>
  mapErr<T>(fn: (err: E) => T): Result<O, T>
  unwrap(): O
  unwrapErr(): E
  expect(message?: string): Result<O, never>
  expectErr(message?: string): Result<never, E>
}

const symResult = Symbol.for('@evologi/result')

function tag<T>(obj: T): T {
  Object.defineProperty(obj, symResult, {
    configurable: true,
    enumerable: false,
    value: true,
    writable: false,
  })
  return obj
}

export function isResult(value: unknown): value is Result<unknown, unknown> {
  return Object(value)[symResult] === true
}

export function ok<O>(value: O): Result<O, never> {
  return tag({
    isErr: false,
    isOk: true,
    expect: () => ok(value),
    expectErr: message => stop(message || 'Expected err result'),
    map: fn => ok(fn(value)),
    mapErr: () => ok(value),
    unwrap: () => value,
    unwrapErr: () => stop('Result is ok'),
    andThen: fn => fn(value),
    orElse: () => ok(value),
  })
}

export function err<E>(value: E): Result<never, E> {
  return tag({
    isErr: true,
    isOk: false,
    expect: message => stop(message || 'Expected ok result'),
    expectErr: () => err(value),
    map: () => err(value),
    mapErr: fn => err(fn(value)),
    unwrap: () => stop('Result is err'),
    unwrapErr: () => value,
    andThen: () => err(value),
    orElse: fn => fn(value),
  })
}

function stop(message: string): never {
  throw new Error(message)
}

export function fromPromise<T>(
  promise: PromiseLike<T>,
): Promise<Result<T, unknown>> {
  return Promise.resolve(promise.then(ok, err))
}
