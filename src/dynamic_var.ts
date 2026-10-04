export class DynamicVar<T> {
    constructor(readonly defaultValue: T) {}
}

export function value<T>(variable: DynamicVar<T>): T {
    return variable.defaultValue
}
