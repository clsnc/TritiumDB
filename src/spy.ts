import { activeDatabase } from './database'
import type { Expression } from './expression'

export function spyExpr<A extends any[], R>(expr: Expression<A, R>): R {
    // Outside of a computation there is no database to track dependencies in,
    // so just evaluate the predicate directly.
    if (activeDatabase === null) {
        return expr.pred(...expr.args)
    }

    return activeDatabase.recordDependencyAndResolve(expr)
}
