import { Database, ImmExpr } from "./database"

// Internal predicates for representing async data
export const ASYNC_CALL_STATUS_INTERNAL_PRED = {}
export const ASYNC_CALL_RESULT_INTERNAL_PRED = {}
export const ASYNC_CALL_PROMISE_INTERNAL_PRED = {}
export const EXPR_PROMISE_INTERNAL_PRED = {}

// Externally-facing async function call statuses
export enum AsyncCallStatus {
    Complete = "Complete",
    Executing = "Executing",
    NotStarted = "NotStarted"
}

export class AsyncCallIncompleteError extends Error {
    public readonly name: string
    
    constructor(readonly incompleteExpr: ImmExpr) {
        super("Async call incomplete")
        this.incompleteExpr = incompleteExpr
    }
}

export function asyncCallStatus<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): AsyncCallStatus {
    // Return whatever status is stored unless it is undefined. In that case, return that the call has not been started.
    return db.spyResult([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args]) as AsyncCallStatus.Complete | AsyncCallStatus.Executing | undefined ?? AsyncCallStatus.NotStarted
}

export function asyncCallResult<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): Awaited<ReturnType<T>> | undefined {
    return db.spyResult([ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args]) as Awaited<ReturnType<T>> | undefined
}

export function resultIsReady<Pred extends (...args: any[]) => any>(db: Database, ...expr: Parameters<Pred> extends [any, ...infer Rest] ? [Pred, ...Rest] : [Pred]): ReturnType<Pred>
export function resultIsReady(db: Database, ...expr: [any, ...any[]]): any
export function resultIsReady(db: Database, ...expr: [any, ...any[]]): any {
    try {
        // Try getting the result of the expression
        db.spyResult(expr)
    } catch (err) {
        if(err instanceof AsyncCallIncompleteError) {
            // If getting the expression throws an error indicating that it depends on an incomplete async call, return that the result is not ready
            return false
        }
    }

    // If some other error is thrown or the result is returned without error, the result is ready
    return true
}