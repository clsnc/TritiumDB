export class Atom<T> {
    constructor(readonly defaultValue: T) {}
}

export function value<T>(atom: Atom<T>): T {
    return atom.defaultValue
}
