import { Map as ImmutableMap, Set as ImmSet } from "immutable";
import { Database } from './database';
import { Expression } from './expression';
import { Atom } from './atom';

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

    subscribe<A extends any[], R>(expr: Expression<A, R>, callback: () => void): () => void {
        // Get the result. The result won't be used, but it any dependencies to be established for expressions with function predicates.
        this.db.getExprResult(expr)

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

    getExprResult<A extends any[], R>(expr: Expression<A, R>): R {
        return this.db.getExprResult(expr);
    }

    // TODO: Add testing for this
    modify<T>(atom: Atom<T>, modifier: (oldValue: T) => T): void {
        this.applyChangeFunc(() => this.db.withModifiedGetAffectedRels(atom, modifier))
    }

    set<T>(atom: Atom<T>, nextValue: T): void {
        this.applyChangeFunc(() => this.db.withGetAffectedRels(atom, nextValue))
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
