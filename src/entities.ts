import { ValueObject } from "immutable"
import { Database } from "./database"

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
