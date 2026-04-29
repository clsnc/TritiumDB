import { Map as ImmutableMap, Set as ImmSet } from "immutable";
import { Database, Expression, expr, Value } from './database';
import { ASYNC_CALL_PROMISE_INTERNAL_PRED, ASYNC_CALL_RESULT_INTERNAL_PRED, ASYNC_CALL_STATUS_INTERNAL_PRED, AsyncCallIncompleteError, AsyncCallStatus, EXPR_PROMISE_INTERNAL_PRED, resultIsReady } from "./async";

export class Reactor {
    private db: Database;
    private subscribers: ImmutableMap<Expression, Set<() => void>> = ImmutableMap();
    private invalidatedExprsPendingSubscriberNotifications: ImmSet<Expression> = ImmSet();

    constructor(initialDb?: Database) {
        this.db = initialDb || new Database();
    }

    // TODO: Add testing for this
    protected applyChangeFunc(func: () => [Database, ImmSet<Expression>]): void {
        const [newDb, affectedExprs] = func()
        this.db = newDb;
        this.invalidatedExprsPendingSubscriberNotifications = this.invalidatedExprsPendingSubscriberNotifications.union(affectedExprs);
    }

    ensureAsyncRun<T extends (...args: any[]) => Promise<any>>(func: T, ...args: Parameters<T>): ReturnType<T> {
        // If a call has not already been initiated, initiate it
        const currStatus = this.db.getResult(expr(ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args))
        if (currStatus === AsyncCallStatus.NotStarted) {
            // Set the executing status immediately
            this.set(expr(ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args), AsyncCallStatus.Executing)
            
            // Call the function and get a promise for the result
            const promise = func(...args) as ReturnType<T>

            // Store the promise so it can be retrieved by later calls of this function
            this.set(expr(ASYNC_CALL_PROMISE_INTERNAL_PRED, func, ...args), promise)

            promise
                .then(retVal => {
                    // If the async call succeeds, record the return value and update the call status in the database
                    this.set(expr(ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args), retVal)
                    this.set(expr(ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args), AsyncCallStatus.Complete)
                    this.flushNotifications()
                }).catch(err => {
                    // If the async call throws an error, record the thrown error and update the call status in the database
                    this.setError(expr(ASYNC_CALL_RESULT_INTERNAL_PRED, func, ...args), err)
                    this.set(expr(ASYNC_CALL_STATUS_INTERNAL_PRED, func, ...args), AsyncCallStatus.Complete)
                    this.flushNotifications()
                }) 

            return promise
        } else {
            // If the async call has already been initiated, return the existing promise
            return this.getResult(expr(ASYNC_CALL_PROMISE_INTERNAL_PRED, func, ...args))
        }
    }

    subscribe(expr: Expression, callback: () => void): () => void {
        // Get the result. The result won't be used, but it any dependencies to be established for expressions with function predicates.
        this.db.getResult(expr)

        // Get or create the callbacks Set
        let exprCallbacks = this.subscribers.get(expr);
        if(!exprCallbacks) {
            exprCallbacks = new Set();
            this.subscribers = this.subscribers.set(expr, exprCallbacks)
        }

        // Add the callback
        exprCallbacks.add(callback);

        // Return a function to unsubscribe
        return () => {
            const exprCallbacks = this.subscribers.get(expr);
            if (exprCallbacks.size === 1) {
                // If this was the only subscription, then this expression's entry should just be deleted
                this.subscribers = this.subscribers.delete(expr);
            } else {
                // Otherwise, just remove this callback
                exprCallbacks.delete(callback)
            }
        };
    }

    getEnsuredResultPromise(expr: Expression): Promise<Value> {
        // Initiate an async function to ensure async runs until the result can finish computing
        const ensureAllRuns = async () => {
            // As long as the expression is not ready, find the next incomplete async expression and ensure it is being run
            const readyExpr = new Expression(resultIsReady, [expr.pred, ...expr.args])
            while(!this.getResult(readyExpr)) {
                /* Because the result isn't considered ready, the only error that should ever be thrown by getting the result 
                   is one indicating an incomplete async call */
                try {
                    this.getResult(expr)
                } catch(err) {
                    // Awaiting prevents the loop from repeatedly ensuring the same dependency
                    try {
                        const incompleteExpr = (err as AsyncCallIncompleteError).incompleteExpr
                        
                        /* AsyncCallIncompleteError is only thrown by spyAsyncEffectResult, which only operates on async function expressions,
                           so the return type is guaranteed to be a Promise. */
                        await this.ensureAsyncRun(incompleteExpr.pred as (...args: any[]) => Promise<any>, ...incompleteExpr.args)
                    } catch(_) {
                        // Nothing needs to be done here if the async call throws an error. How that is handled is up to the calling predicate function.
                    }
                }
            }
        }
        ensureAllRuns()

        return this.getResultPromise(expr)
    }

    getResult(expr: Expression) {
        return this.db.getResult(expr);
    }

    getResultPromise(expr: Expression): Promise<Value> {
        // If there is already a stored promise for this result, return it. Otherwise, create one, store it, and return it.
        const storedPromiseExpr = new Expression(EXPR_PROMISE_INTERNAL_PRED, [expr.pred, ...expr.args])
        const storedPromise = this.getResult(storedPromiseExpr)
        if(storedPromise) {
            return storedPromise
        } else {
            let promise: Promise<Value>

            // Figure out whether the expression result is already ready
            const readyExpr = new Expression(resultIsReady, [expr.pred, ...expr.args])
            const isReady = this.getResult(readyExpr)

            if (isReady) {
                try {
                    // If the result is ready and there is a return value, return a resolved promise
                    promise = Promise.resolve(this.getResult(expr))
                } catch(err) {
                    // If the result is ready but it is a thrown error, return a rejected promise
                    promise = Promise.reject(err)
                }
            } else {
                // If the result is not ready, return an unresolved promise
                promise = new Promise((resolve, reject) => {
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

            // Record the promise to be returned by future calls
            this.set(storedPromiseExpr, promise)

            return promise
        }
    }

    // TODO: Add testing for this
    modify(expr: Expression, modifier: (oldValue: Value) => Value): void {
        this.applyChangeFunc(() => this.db.withModifiedGetAffectedRels(expr, modifier))
    }

    set(expr: Expression, result: Value): void {
        this.applyChangeFunc(() => this.db.withGetAffectedRels(expr, result))
    }

    setError(expr: Expression, err: any): void {
        this.applyChangeFunc(() => this.db.withErrorGetAffectedRels(expr, err))
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
        this.invalidatedExprsPendingSubscriberNotifications = ImmSet();
    }
}
