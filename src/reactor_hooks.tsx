import { useSyncExternalStore } from "react"
import { Reactor } from "./reactor"
import { ListyExpr, Value } from "./database"

export function useResult(dbr: Reactor, expr: ListyExpr): Value {
    return useSyncExternalStore((callback: () => void) => dbr.subscribe(expr, callback), () => dbr.getResult(expr))
}