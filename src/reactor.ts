import { Map as ImmutableMap, Set as ImmSet } from "immutable";
import { Database } from './database';
import { Expression, expr } from './expression';
import { Atom, type AtomAssignments } from './atom';

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
        this.flushNotifications();
    }

    watch<A extends any[], R>(callback: () => void, pred: (...args: A) => R, ...args: A): () => void {
        return this.watchExpr(callback, expr(pred, ...args));
    }

    watchExpr<A extends any[], R>(callback: () => void, expr: Expression<A, R>): () => void {
        // Get the result. The result won't be used, but it any dependencies to be established for expressions with function predicates.
        this.db.evalExpr(expr)

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
            if(exprCallbacks) { // This check is necessary in case all callbacks have already been unsubscribed
                if (exprCallbacks.size === 1) {
                    // If this was the only subscription, then this expression's entry should just be deleted
                    this.subscribers = this.subscribers.delete(expr);
                } else {
                    // Otherwise, just remove this callback
                    exprCallbacks.delete(callback)
                }
            }
        };
    }

    evalExpr<A extends any[], R>(expr: Expression<A, R>): R {
        return this.db.evalExpr(expr);
    }

    eval<A extends any[], R>(pred: (...args: A) => R, ...args: A): R {
        return this.evalExpr(expr(pred, ...args));
    }

    // TODO: Add testing for this
    modify<T>(atom: Atom<T>, modifier: (oldValue: T) => T): void {
        this.applyChangeFunc(() => this.db.withModifiedGetAffectedRels(atom, modifier))
    }

    set<T>(atom: Atom<T>, nextValue: T): void {
        this.applyChangeFunc(() => this.db.withGetAffectedRels(atom, nextValue))
    }

    setMany<T extends readonly unknown[]>(...assignments: AtomAssignments<T>): void {
        this.applyChangeFunc(() => this.db.withManyGetAffectedRels(...assignments))
    }

    protected flushNotifications(): void {
        /* Capture the pending notifications, then empty the stored ones. This prevents 
           infinitely repeating notifications if a callback triggers another flush. */
        const pendingNotifications = this.invalidatedExprsPendingSubscriberNotifications;
        this.invalidatedExprsPendingSubscriberNotifications = ImmSet();

        // Call the callbacks for each notification
        for (const affectedExpr of pendingNotifications) {
            const callbacks = this.subscribers.get(affectedExpr);
            if (callbacks) {
                for (const callback of callbacks) {
                    callback();
                }
            }
        }
    }
}
