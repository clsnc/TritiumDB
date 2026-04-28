import { Database, Expression, expr } from "./database"

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
    
    constructor(readonly incompleteExpr: Expression) {
        super("Async call incomplete")
        this.incompleteExpr = incompleteExpr
    }
}

export function asyncCallStatus<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): AsyncCallStatus {
    // Return whatever status is stored unless it is undefined. In that case, return that the call has not been started.
    return db.spyResult(expr(ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args)) as AsyncCallStatus.Complete | AsyncCallStatus.Executing | undefined ?? AsyncCallStatus.NotStarted
}

export function asyncCallResult<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): Awaited<ReturnType<T>> | undefined {
    return db.spyResult(expr(ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args)) as Awaited<ReturnType<T>> | undefined
}

export function resultIsReady(db: Database, pred: any, ...args: any[]): any
export function resultIsReady(db: Database, pred: any, ...args: any[]): any {
    try {
        // Try getting the result of the expression
        db.spyResult(new Expression(pred, args))
    } catch (err) {
        if(err instanceof AsyncCallIncompleteError) {
            // If getting the expression throws an error indicating that it depends on an incomplete async call, return that the result is not ready
            return false
        }
    }

    // If some other error is thrown or the result is returned without error, the result is ready
    return true
}
