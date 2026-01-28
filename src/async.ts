import { Database } from "./database"

// Internal predicates for representing async function call statuses
export const ASYNC_CALL_STATUS_INTERNAL_PRED = {}
export const ASYNC_CALL_RESULT_INTERNAL_PRED = {}

// Externally-facing async function call statuses
export enum AsyncCallStatus {
    Complete = "Complete",
    Executing = "Executing",
    NotStarted = "NotStarted"
}

export function asyncCallStatus<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): AsyncCallStatus {
    // Return whatever status is stored unless it is undefined. In that case, return that the call has not been started.
    return db.spyResult([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args]) as AsyncCallStatus.Complete | AsyncCallStatus.Executing | undefined ?? AsyncCallStatus.NotStarted
}

export function asyncCallResult<T extends (...args: any[]) => Promise<any>>(db: Database, func: T, ...args: Parameters<T>): Awaited<ReturnType<T>> | undefined {
    return db.spyResult([ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args]) as Awaited<ReturnType<T>> | undefined
}