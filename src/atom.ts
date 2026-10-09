export class Atom<T> {
    constructor(readonly defaultValue: T) {}
}

// A list of [<atom>, <atomValue>] pairs
export type AtomAssignments<T extends readonly unknown[]> = {
    [K in keyof T]: readonly [Atom<T[K]>, NoInfer<T[K]>]
}

export function value<T>(atom: Atom<T>): T {
    return atom.defaultValue
}
