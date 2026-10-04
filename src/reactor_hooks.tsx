import { useSyncExternalStore } from "react"
import { Reactor } from "./reactor"
import { Expression } from "./expression"

export function useResult<A extends any[], R>(dbr: Reactor, expr: Expression<A, R>): R {
    return useSyncExternalStore((callback: () => void) => dbr.subscribe(expr, callback), () => dbr.getResult(expr))
}