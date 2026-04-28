import { useSyncExternalStore } from "react"
import { Reactor } from "./reactor"
import { Expression, Value } from "./database"

export function useResult(dbr: Reactor, expr: Expression): Value {
    return useSyncExternalStore((callback: () => void) => dbr.subscribe(expr, callback), () => dbr.getResult(expr))
}