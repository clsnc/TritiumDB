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

    subscribe(expr: ListyExpr, callback: () => void): () => void {
        // Make sure the expression is represented as an immutable List
        const immExpr: ImmExpr = List(expr);

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