import { Database, Expression, expr } from "./database"

// Externally-facing async function call statuses
export enum AsyncCallStatus {
    Complete = "Complete",
    Executing = "Executing",
    NotStarted = "NotStarted"
}

// Internal predicates for representing async data
export const ASYNC_CALL_STATUS_INTERNAL_PRED =
    (_db: Database, _func: any, ..._args: any[]): AsyncCallStatus => AsyncCallStatus.NotStarted

export const ASYNC_CALL_RESULT_INTERNAL_PRED =
    (_db: Database, _func: any, ..._args: any[]): any => undefined

export const ASYNC_CALL_PROMISE_INTERNAL_PRED =
    (_db: Database, _func: any, ..._args: any[]): Promise<any> | undefined => undefined

export const EXPR_PROMISE_INTERNAL_PRED =
    (_db: Database, ..._args: any[]): Promise<any> | undefined => undefined

export class AsyncCallIncompleteError extends Error {
    public readonly name: string
    
    constructor(readonly incompleteExpr: Expression) {
        super("Async call incomplete")
        this.incompleteExpr = incompleteExpr
    }
}

export function asyncCallStatus<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): AsyncCallStatus {
    return db.spyResult(expr(ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args))
}

export function asyncCallResult<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): Awaited<ReturnType<T>> | undefined {
    return db.spyResult(expr(ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args)) as Awaited<ReturnType<T>> | undefined
}

export function resultIsReady(db: Database, pred: (...args: any[]) => any, ...args: any[]): boolean {
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
