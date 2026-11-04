import { useSyncExternalStore } from "react"
import { Reactor } from "./reactor"
import { Expression, expr } from "./expression"
import { memoize } from "./memoize"

export function useEval<A extends any[], R>(dbr: Reactor, pred: (...args: A) => R, ...args: A): R {
    return useEvalExpr(dbr, expr(pred, ...args))
}

export function useEvalExpr<A extends any[], R>(dbr: Reactor, expression: Expression<A, R>): R {
    // We memoize here because useSyncExternalStore needs stable getSnapshot return values
    const memoizedExpression = expr(memoize(expression.pred), ...expression.args)

    return useSyncExternalStore((callback: () => void) => dbr.watchExpr(callback, memoizedExpression), () => dbr.evalExpr(memoizedExpression))
}