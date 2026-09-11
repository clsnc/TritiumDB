import { Map as ImmutableMap, Set as ImmSet } from "immutable";
import { Database, Expression, Value } from './database';

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

    getResult(expr: Expression) {
        return this.db.getResult(expr);
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
