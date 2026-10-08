import { useSyncExternalStore } from "react"
import { Reactor } from "./reactor"
import { Expression } from "./expression"

export function useEvalExpr<A extends any[], R>(dbr: Reactor, expr: Expression<A, R>): R {
    return useSyncExternalStore((callback: () => void) => dbr.subscribe(expr, callback), () => dbr.evalExpr(expr))
}