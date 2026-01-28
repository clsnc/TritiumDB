import { List, Map as ImmutableMap, Set as ImmSet } from "immutable";
import { Database, ListyExpr, ImmExpr, Value} from './database';

export class Reactor {
    private db: Database;
    private subscribers: ImmutableMap<ImmExpr, Set<() => void>> = ImmutableMap();
    private invalidatedExprsPendingSubscriberNotifications: Set<ImmExpr> = new Set();

    constructor(initialDb?: Database) {
        this.db = initialDb || new Database();
    }

    // TODO: Add testing for this
    protected applyChangeFunc(func: () => [Database, ImmSet<ImmExpr>]): void {
        const [newDb, affectedExprs] = func()
        this.db = newDb;
        affectedExprs.forEach(expr => this.invalidatedExprsPendingSubscriberNotifications.add(expr));
    }

    ensureAsyncRun<T extends (...args: any[]) => Promise<any>>(func: T, ...args: Parameters<T>): void {
        // If a call has not already been initiated, initiate it
        const currStatus = this.db.getResult([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args])
        if (currStatus === undefined) {
            // Set the executing status immediately
            this.set([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args], AsyncCallStatus.Executing)

            // Initiate the call and set a callback
            func(...args).then(retVal => {
                // Set the return value and update the call status in the database
                this.set([ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args], retVal)
                this.set([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args], AsyncCallStatus.Complete)
                this.flushNotifications()
            })
        }
    }

    subscribe(expr: ListyExpr, callback: () => void): () => void {
        // Make sure the expression is represented as an immutable List
        const immExpr: ImmExpr = List(expr);

        // Get the result. The result won't be used, but it any dependencies to be established for expressions with function predicates.
        this.db.getResult(immExpr)

        // Get or create the callbacks Set
        let exprCallbacks = this.subscribers.get(immExpr);
        if(!exprCallbacks) {
            exprCallbacks = new Set();
            this.subscribers = this.subscribers.set(immExpr, exprCallbacks)
        }

        // Add the callback
        exprCallbacks.add(callback);

        // Return a function to unsubscribe
        return () => {
            const exprCallbacks = this.subscribers.get(immExpr);
            if (exprCallbacks.size === 1) {
                // If this was the only subscription, then this expression's entry should just be deleted
                this.subscribers = this.subscribers.delete(immExpr);
            } else {
                // Otherwise, just remove this callback
                exprCallbacks.delete(callback)
            }
        };
    }

    getResult(expr: ListyExpr) {
        return this.db.getResult(expr);
    }

    // TODO: Add testing for this
    modify(expr: ListyExpr, modifier: (oldValue: Value) => Value): void {
        this.applyChangeFunc(() => this.db.withModifiedGetAffectedRels(expr, modifier))
    }

    set(expr: ListyExpr, result: Value): void {
        this.applyChangeFunc(() => this.db.withGetAffectedRels(expr, result))     
    }

    flushNotifications(): void {
        for (const affectedExpr of this.invalidatedExprsPendingSubscriberNotifications) {
            const callbacks = this.subscribers.get(affectedExpr);
            if (callbacks) {
                for (const callback of callbacks) {
                    callback();
                }
            }
        }
        this.invalidatedExprsPendingSubscriberNotifications.clear();
    }
}

// Internal predicates for representing async function call statuses
const ASYNC_CALL_STATUS_INTERNAL_PRED = {}
const ASYNC_CALL_RESULT_INTERNAL_PRED = {}

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