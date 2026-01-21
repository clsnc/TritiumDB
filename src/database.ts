import { List as ImmList, Map as ImmMap, Set as ImmSet, Record } from "immutable"

type Function = (...args: any[]) => any

export type Value = any
export type ImmExpr = ImmList<Value>
export type ArrExpr = Value[]
export type ListyExpr = ImmExpr | ArrExpr

export class DerivativeId extends Record({
    creatingExpr: null,
    uniqueKey: null
}) {
    constructor(creatingExpr: ImmExpr, uniqueKey: any) {
        super({ creatingExpr, uniqueKey })
    }
}

export class CascadingPredicate {
    setter: (db: Database, expr: ImmExpr, result: Value) => void

    constructor(setter: (db: Database, expr: ImmExpr, result: Value) => void) {
        this.setter = setter
    }
}

export class Database {
    protected cascadingPredicateAffectedExprsDuringSet: ImmSet<ImmExpr> | null
    protected currentlyComputingExprs: ImmSet<ImmExpr>
    protected currentDeepestComputingExpr: ImmExpr | null
    protected exprToCachedResult: ImmMap<ImmExpr, Value>
    protected exprToContributorExprs: ImmMap<ImmExpr, ImmSet<ImmExpr>>
    protected exprToDependentExprs: ImmMap<ImmExpr, ImmSet<ImmExpr>>

    constructor(
        exprToCachedResult: ImmMap<ImmExpr, Value> = ImmMap<ImmExpr, Value>(),
        exprToContributorExprs: ImmMap<ImmExpr, ImmSet<ImmExpr>> = ImmMap<ImmExpr, ImmSet<ImmExpr>>(),
        exprToDependentExprs: ImmMap<ImmExpr, ImmSet<ImmExpr>> = ImmMap<ImmExpr, ImmSet<ImmExpr>>()
    ) {
        this.cascadingPredicateAffectedExprsDuringSet = null
        this.currentlyComputingExprs = ImmSet<ImmExpr>()
        this.currentDeepestComputingExpr = null
        this.exprToCachedResult = exprToCachedResult
        this.exprToContributorExprs = exprToContributorExprs
        this.exprToDependentExprs = exprToDependentExprs
    }

    protected addDependency(dependentExpr: ImmExpr, contributorExpr: ImmExpr): void {
        // Record the contributor expression in the set of the dependent expression's contributors
        this.exprToContributorExprs = this.exprToContributorExprs.update(dependentExpr, contributorExprs => (contributorExprs || ImmSet()).add(contributorExpr))

        // Record the dependent expression in the set of the contributor expression's dependents
        this.exprToDependentExprs = this.exprToDependentExprs.update(contributorExpr, dependentExprs => (dependentExprs || ImmSet()).add(dependentExpr))
    }

    getDerivativeId(uniqueKey: any = undefined): DerivativeId {
        if (this.currentDeepestComputingExpr === null) {
            throw new Error("getDerivativeId can only be called during expression computation")
        }

        return new DerivativeId(this.currentDeepestComputingExpr, uniqueKey)
    }

    protected clearExprDependencies(expr: ImmExpr): void {
        // Get the contributing expressions for this expression
        const contributorKeys = this.exprToContributorExprs.get(expr)

        // Remove this expression's contributor relationships
        this.exprToContributorExprs = this.exprToContributorExprs.delete(expr)

        // Remove this expression from each contributor's dependency tracking
        contributorKeys?.forEach(contributorKey => {
            this.exprToDependentExprs = this.exprToDependentExprs.update(contributorKey, dependentKeys => dependentKeys.delete(expr))
        })
    }

    protected invalidateSingleExprResult(expr: ImmExpr): void {
        // Remove the cached result for this expression
        this.exprToCachedResult = this.exprToCachedResult.delete(expr)

        // Clear dependency tracking for this expression
        this.clearExprDependencies(expr)
    }

    protected getAllDependentExprsIncludingSeed(expr: ImmExpr): ImmSet<ImmExpr> {
        // Perform a breadth-first search to find all direct or indrirect dependent expressions
        let discoveredExprs = ImmSet<ImmExpr>([expr])
        const exprVisitQueue: ImmExpr[] = [expr]
        while (exprVisitQueue.length > 0) {
            const currentExpr = exprVisitQueue.pop()
            const currentDependentExprs = this.exprToDependentExprs.get(currentExpr) || ImmSet<ImmExpr>()
            currentDependentExprs.forEach(dependentExpr => {
                if (!discoveredExprs.has(dependentExpr)) {
                    discoveredExprs = discoveredExprs.add(dependentExpr)
                    exprVisitQueue.push(dependentExpr)
                }
            })
        }

        return discoveredExprs
    }

    getResult(expr: ListyExpr): Value {
        return this.getResultFromImmExpr(ImmList(expr))
    }

    protected getResultFromImmExpr(expr: ImmExpr): Value {
        // If there is already a cached result for this expression, return it
        if (this.exprToCachedResult.has(expr)) {
            return this.exprToCachedResult.get(expr)
        }

        // If there is no cached result but the predicate is a function, compute the result and return that
        const pred = expr.get(0)
        if (typeof pred === "function") {
            return this.updateExprCacheAndGetResult(expr)
        }

        // Check if any terms in the expression are derivative IDs and recompute their creating expressions if needed
        /* TODO: It is possible for derivative expressions to be set using derivative IDs that were created during the computation 
           of other expressions. In those cases, this will fail to compute the expression needed to set the derivative expression. 
           Some strategy should be figured out to determine what expression actually needs to be recomputed to get the derivative 
           expression to be set. */
        for (const term of expr) {
            if (term instanceof DerivativeId) {
                const creatingExpr = term.creatingExpr
                if (!this.exprToCachedResult.has(creatingExpr)) {
                    this.getResultFromImmExpr(creatingExpr)
                }
            }
        }

        // After checking derivative IDs, return the cached result, or undefined if it still doesn't exist
        return this.exprToCachedResult.get(expr)
    }

    protected setDeepestComputingExpr(expr: ImmExpr | null): void {
        this.currentDeepestComputingExpr = expr
    }

    setDerivative(expr: ListyExpr, result: Value): void {
        if (this.currentDeepestComputingExpr === null) {
            throw new Error("setDerivative can only be called during expression computation")
        }

        const derivativeExpr = ImmList(expr)

        // Set the result
        /* Any dependencies on this derivative expression should have been invalidated when the setting expression was, 
           so getting affected expressions shouldn't be significant waste of compute. */
        this.setResultGetAffectedExprs(derivativeExpr, result)

        // Mark the derivative expression as dependent on the currently computing expression
        this.addDependency(derivativeExpr, this.currentDeepestComputingExpr)

    }

    protected setResultGetAffectedExprs(expr: ListyExpr, result: Value): ImmSet<ImmExpr> {
        const immExpr: ImmExpr = ImmList(expr)
        let affectedExprs = this.getAllDependentExprsIncludingSeed(immExpr)
        
        // Invalidate all affected expressions
        affectedExprs.forEach(affectedExpr => {
            this.invalidateSingleExprResult(affectedExpr)
        })

        // Set the result in the cache
        this.exprToCachedResult = this.exprToCachedResult.set(immExpr, result)

        // If this expression has a Cascading Predicate, set any consequences and keep track of affected expressions.
        /* This is done after affected expression invalidation to avoid invalidating expressions set as consequences. This is okay because consequences 
           will invalidate their own affected expressions. */
        const pred = immExpr.get(0)
        if(pred instanceof CascadingPredicate) {
            // Check whether a cascading predicate is already being set (meaning this one being set is a consequence of another being set)
            const alreadyInCascadingPredicateSet = this.cascadingPredicateAffectedExprsDuringSet !== null

            // Record the previous calling expression so it can be restored when we're done
            const prevCallingExpr = this.currentDeepestComputingExpr

            // Mark this expression as the calling expression so that derivative expressions are marked as dependent on it
            this.currentDeepestComputingExpr = immExpr

            // If this predicate starts a predicate cascade, initialize a set to keep track of affected expressions
            if(!alreadyInCascadingPredicateSet) {
                this.cascadingPredicateAffectedExprsDuringSet = ImmSet()
            // If this predicate is part of an existing predicate cascade, we just need to add it to the tracking set.
            } else {
                this.cascadingPredicateAffectedExprsDuringSet = this.cascadingPredicateAffectedExprsDuringSet.add(immExpr)
            }

            // Apply the predicate's setter function to set any consequences
            pred.setter(this, immExpr, result)

            // If this predicate started a predicate cascade, record the affected expressions and remove the set for tracking them
            if(!alreadyInCascadingPredicateSet) {
                affectedExprs = affectedExprs.union(this.cascadingPredicateAffectedExprsDuringSet)
                this.cascadingPredicateAffectedExprsDuringSet = null
            }

            // Restore the previous calling expression
            this.currentDeepestComputingExpr = prevCallingExpr
        }

        return affectedExprs
    }

    spyResult<Pred extends Function>(expr: Parameters<Pred> extends [any, ...infer Rest] ? [Pred, ...Rest] : [Pred]): ReturnType<Pred>
    spyResult(expr: [any, ...any[]]): any
    spyResult(expr: [any, ...any[]]): any {
        const immExpr: ImmExpr = ImmList(expr)
        
        /* If there is a currently computing expression, then that expression must depend on the one 
           whose result is being requested. So that dependency should be recorded. */
        if (this.currentDeepestComputingExpr !== null) {
            this.addDependency(this.currentDeepestComputingExpr, immExpr)
        }

        return this.getResultFromImmExpr(immExpr)
    }

    protected updateExprCacheAndGetResult(expr: ImmExpr): any {
        /* Compute the result unless we are already computing, in which case
           we return undefined, as this means we are in a recursive call */
        if (this.currentlyComputingExprs.has(expr)) {
            return undefined
        }

        // Record the previous calling key so it can be restored when we're done
        const prevCallingKey = this.currentDeepestComputingExpr

        /* Mark this expression as the calling expression so that contributing expressions know to
           invalidate this expression when they are updated */
        this.setDeepestComputingExpr(expr)

        /* Mark this expression as currently computing so that we don't
           recursively compute the same expression while calling the function */
        this.currentlyComputingExprs = this.currentlyComputingExprs.add(expr)

        // Compute the result
        const func = expr.get(0)
        const args = expr.shift()
        const result = func(this, ...args)

        /* Because the function call is done, we can unmark this key as
           currently computing */
        this.currentlyComputingExprs = this.currentlyComputingExprs.delete(expr)

        // Restore the previous calling key
        this.setDeepestComputingExpr(prevCallingKey)

        // Update the cache with the computed result
        this.exprToCachedResult = this.exprToCachedResult.set(expr, result)

        return result
    }

    with(expr: ListyExpr, result: Value): Database {
        // Return just the new database
        return this.withGetAffectedRels(expr, result)[0]
    }

    withGetAffectedRels(expr: ListyExpr, result: Value): [Database, ImmSet<ImmExpr>] {
        // Create a new database instance that is just like the current one
        const newDb = new Database(
            this.exprToCachedResult,
            this.exprToContributorExprs,
            this.exprToDependentExprs
        )

        // Apply the change to the new database and get expressions that have been invalidated because of it
        const affectedRels = newDb.setResultGetAffectedExprs(expr, result)

        return [newDb, affectedRels]
    }

    withModified(expr: ListyExpr, modifier: (val: Value) => Value): Database {
        // Return just the new database
        return this.withModifiedGetAffectedRels(expr, modifier)[0]
    }

    withModifiedGetAffectedRels(expr: ListyExpr, modifier: (oldResult: Value) => Value): [Database, ImmSet<ImmExpr>] {
        // The new result is the old result with the modifier function applied to it
        const newResult = modifier(this.getResult(expr))
        return this.withGetAffectedRels(expr, newResult)
    }
}