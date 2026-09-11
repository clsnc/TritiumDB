import { ValueObject } from "immutable"
import { Database, expr } from "./database"

export type ReactiveEntityData = Record<any, any>;

export class ReactiveEntity<T extends ReactiveEntityData> implements ValueObject {
    constructor(readonly id: number) {}

    hashCode(): number { return this.id }

    equals(other: unknown): boolean {
        return other instanceof ReactiveEntity && this.id === other.id
    }
}

export const property = <T extends ReactiveEntityData, K extends keyof T>(
    _db: Database, _entity: ReactiveEntity<T>, key: K
): T[K] => {
    throw new Error(`Property '${String(key)}' not found on entity`)
}

type MethodKeys<T extends ReactiveEntityData> = {
    [K in keyof T]: T[K] extends ((db: Database, entity: ReactiveEntity<T>, ...args: any[]) => any) ? K : never
}[keyof T]

export const method = <T extends ReactiveEntityData, K extends MethodKeys<T>>(
    db: Database, entity: ReactiveEntity<T>, key: K
): T[K] => {
    return db.spyResult(expr(property, entity, key))
}

type MethodArgs<T extends ReactiveEntityData, K extends keyof T> =
    T[K] extends ((db: Database, entity: ReactiveEntity<T>, ...args: infer A) => any) ? A : never

type MethodReturn<T extends ReactiveEntityData, K extends keyof T> =
    T[K] extends ((db: Database, entity: ReactiveEntity<T>, ...args: any[]) => infer R) ? R : never

export const callMethod = <T extends ReactiveEntityData, K extends MethodKeys<T>>(
    db: Database, entity: ReactiveEntity<T>, methodName: K, ...args: MethodArgs<T, K>
): MethodReturn<T, K> => {
    const methodFn = db.spyResult(expr(method, entity, methodName))
    return db.spyResult(expr(methodFn, entity, ...args))
}
