import { spy } from './spy'

const memoizedFunctions = new WeakMap<(...args: any[]) => any, (...args: any[]) => any>()

/** Returns a wrapper function that caches function call results within the active database. Multiple calls with the same function will return the same wrapper. */
export function memoize<A extends any[], R>(pred: (...args: A) => R): (...args: A) => R {
    // Return a cached wrapper function if there is one
    const cached = memoizedFunctions.get(pred)
    if (cached) return cached;

    // If no cached wrapper exists, create a new one and cache it
    const wrapped = (...args: A): R => spy(pred, ...args)
    memoizedFunctions.set(pred, wrapped)

    return wrapped
}
