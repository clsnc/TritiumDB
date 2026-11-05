import { activeDatabase } from './database'

export interface Atom<T> {
    (): T
    readonly defaultValue: T
}

/** Creates an atom with the given default value. */
export function atom<T>(defaultValue: T): Atom<T> {
    const read = (): T => activeDatabase === null
        ? read.defaultValue
        : activeDatabase.spyAtomValue(read)
    read.defaultValue = defaultValue
    return read
}

// A list of [<atom>, <atomValue>] pairs
export type AtomAssignments<T extends readonly unknown[]> = {
    [K in keyof T]: readonly [Atom<T[K]>, NoInfer<T[K]>]
}
