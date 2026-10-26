import { spy } from './spy'

/** Caches function call results within the active database. */
export function memoize<A extends any[], R>(pred: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => spy(pred, ...args)
}
