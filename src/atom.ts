import { activeDatabase } from './database'

export class Atom<T> {
    constructor(readonly defaultValue: T) {}
}

/** Creates an atom with the given default value. */
export function atom<T>(defaultValue: T): Atom<T> {
    return new Atom(defaultValue)
}

// A list of [<atom>, <atomValue>] pairs
export type AtomAssignments<T extends readonly unknown[]> = {
    [K in keyof T]: readonly [Atom<T[K]>, NoInfer<T[K]>]
}

export function value<T>(atom: Atom<T>): T {
    return activeDatabase === null
        ? atom.defaultValue
        : activeDatabase.spyAtomValue(atom)
}
