import { useSyncExternalStore } from "react"
import { Reactor } from "./reactor"
import { Expression, expr } from "./expression"

export function useEval<A extends any[], R>(dbr: Reactor, pred: (...args: A) => R, ...args: A): R {
    return useEvalExpr(dbr, expr(pred, ...args))
}

export function useEvalExpr<A extends any[], R>(dbr: Reactor, expr: Expression<A, R>): R {
    return useSyncExternalStore((callback: () => void) => dbr.watchExpr(callback, expr), () => dbr.evalExpr(expr))
}