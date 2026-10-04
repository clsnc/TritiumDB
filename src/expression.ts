import { List as ImmList, ValueObject } from "immutable"

export class Expression<A extends any[] = any[], R = any> implements ValueObject {
    private readonly _list: ImmList<any>

    constructor(pred: (...args: A) => R, args: A) {
        this._list = ImmList([pred, ...args])
    }

    get pred(): (...args: A) => R { return this._list.get(0) }
    get args(): A { return this._list.shift().toArray() as A }

    hashCode(): number { return this._list.hashCode() }

    equals(other: unknown): boolean {
        return other instanceof Expression && this._list.equals((other as Expression)._list)
    }

    toJSON(): object {
        return {
            pred: this.pred.name || 'anonymous',
            args: this.args
        }
    }

    toString(): string {
        return JSON.stringify(this)
    }

    [Symbol.iterator](): Iterator<any> { return this._list[Symbol.iterator]() }
}

export function expr<A extends any[], R>(
    pred: (...args: A) => R, ...args: A
): Expression<A, R> {
    return new Expression(pred, args)
}
