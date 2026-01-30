import { List, Map as ImmutableMap, Set as ImmSet } from "immutable";
import { Database, ListyExpr, ImmExpr, Value} from './database';
import { ASYNC_CALL_PROMISE_INTERNAL_PRED, ASYNC_CALL_RESULT_INTERNAL_PRED, ASYNC_CALL_STATUS_INTERNAL_PRED, AsyncCallStatus, resultIsReady } from "./async";

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

    ensureAsyncRun<T extends (...args: any[]) => Promise<any>>(func: T, ...args: Parameters<T>): ReturnType<T> {
        // If a call has not already been initiated, initiate it
        const currStatus = this.db.getResult([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args])
        if (currStatus === undefined) {
            // Set the executing status immediately
            this.set([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args], AsyncCallStatus.Executing)
            
            // Call the function and get a promise for the result
            const promise = func(...args) as ReturnType<T>

            // Store the promise so it can be retrieved by later calls of this function
            this.set([ASYNC_CALL_PROMISE_INTERNAL_PRED, func, ...args], promise)

            // Initiate the call and set a callback
            promise.then(retVal => {
                // Set the return value and update the call status in the database
                this.set([ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args], retVal)
                this.set([ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args], AsyncCallStatus.Complete)
                this.flushNotifications()
            })

            return promise
        } else {
            // If the async call has already been initiated, return the existing promise
            return this.getResult([ASYNC_CALL_PROMISE_INTERNAL_PRED, func, ...args])
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

    getResultPromise(expr: ListyExpr): Promise<Value> {
        // Figure out whether the expression result is already ready
        const readyExpr: ListyExpr = [resultIsReady, ...expr]
        const isReady = this.getResult(readyExpr)

        if (isReady) {
            try {
                // If the result is ready and there is a return value, return a resolved promise
                return Promise.resolve(this.getResult(expr))
            } catch(err) {
                // If the result is ready but it is a thrown error, return a rejected promise
                return Promise.reject(err)
            }
        } else {
            // If the result is not ready, return an unresolved promise
            return new Promise((resolve, reject) => {
                // Subscribe the readiness of this expression
                const unsubscribe = this.subscribe(readyExpr, () => {
                    // When the readiness result changes, get it
                    const nowReady = this.getResult(readyExpr)

                    // If the result is now ready, return it or throw the error
                    if(nowReady) {
                        try {
                            // If there is a return value, resolve the promise
                            resolve(this.getResult(expr))
                        } catch (err) {
                            // If getting the expression throws an error, reject the promise
                            reject(err)
                            return
                        }

                        // Since the promise has either been resolved or rejected, we can unsubscribe
                        unsubscribe()
                    }
                })
            })
        }
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