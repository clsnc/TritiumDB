import { List as ImmList, Map as ImmMap, Set as ImmSet, ValueObject } from "immutable"

export type Value = any

export class Expression<A extends any[] = any[], R = any> implements ValueObject {
    private readonly _list: ImmList<any>

    constructor(pred: (...args: A) => R, args: A) {
        this._list = ImmList([pred, ...args])
    }

    get pred(): (...args: A) => R { return this._list.get(0) }
    get args(): A { return this._list.shift().toArray() as A }

    hashCode(): number { return this._list.hashCode() }

    equals(other: unknown): boolean {
        return other instanceof Expression && this._list.equals((other as Expression)._list)
    }

    toJSON(): object {
        return {
            pred: this.pred.name || 'anonymous',
            args: this.args
        }
    }

    toString(): string {
        return JSON.stringify(this)
    }

    [Symbol.iterator](): Iterator<any> { return this._list[Symbol.iterator]() }
}

export function expr<A extends any[], R>(
    pred: (...args: A) => R, ...args: A
): Expression<A, R> {
    return new Expression(pred, args)
}

export class RecursiveExpressionComputationError extends Error {
    public readonly name: string

    constructor(readonly recursiveExpr: Expression) {
        super("Recursive expression computation detected")
        this.recursiveExpr = recursiveExpr
        this.name = "RecursiveExpressionComputationError"
    }
}

class ExpressionResult {
    constructor(readonly value: Value | Error, readonly isReturnValue: boolean) {}
}

let activeDatabase: Database | null = null

export class Database {
    protected currentlyComputingExprs: ImmSet<Expression>
    protected currentDeepestComputingExpr: Expression | null
    protected exprToCachedResult: ImmMap<Expression, ExpressionResult>
    protected exprToContributorExprs: ImmMap<Expression, ImmSet<Expression>>
    protected exprToDependentExprs: ImmMap<Expression, ImmSet<Expression>>

    constructor(
        exprToCachedResult: ImmMap<Expression, ExpressionResult> = ImmMap<Expression, ExpressionResult>(),
        exprToContributorExprs: ImmMap<Expression, ImmSet<Expression>> = ImmMap<Expression, ImmSet<Expression>>(),
        exprToDependentExprs: ImmMap<Expression, ImmSet<Expression>> = ImmMap<Expression, ImmSet<Expression>>()
    ) {
        this.currentlyComputingExprs = ImmSet<Expression>()
        this.currentDeepestComputingExpr = null
        this.exprToCachedResult = exprToCachedResult
        this.exprToContributorExprs = exprToContributorExprs
        this.exprToDependentExprs = exprToDependentExprs
    }

    protected addDependency(dependentExpr: Expression, contributorExpr: Expression): void {
        // Record the contributor expression in the set of the dependent expression's contributors
        this.exprToContributorExprs = this.exprToContributorExprs.update(dependentExpr, contributorExprs => (contributorExprs || ImmSet()).add(contributorExpr))

        // Record the dependent expression in the set of the contributor expression's dependents
        this.exprToDependentExprs = this.exprToDependentExprs.update(contributorExpr, dependentExprs => (dependentExprs || ImmSet()).add(dependentExpr))
    }

    protected clearExprDependencies(expr: Expression): void {
        // Get the contributing expressions for this expression
        const contributorExprs = this.exprToContributorExprs.get(expr)

        // Remove this expression's contributor relationships
        this.exprToContributorExprs = this.exprToContributorExprs.delete(expr)

        // Remove this expression from each contributor's dependency tracking
        contributorExprs?.forEach(contributorExpr => {
            this.exprToDependentExprs = this.exprToDependentExprs.update(contributorExpr, dependentExprs => {
                // @ts-expect-error dependentExprs should always be defined because contributor and dependent expressions are always set together
                return dependentExprs.delete(expr)
            })
        })
    }

    protected invalidateSingleExprResult(expr: Expression): void {
        // Remove the cached result or error for this expression
        this.exprToCachedResult = this.exprToCachedResult.delete(expr)

        // Clear dependency tracking for this expression
        this.clearExprDependencies(expr)
    }

    protected getAllDependentExprsIncludingSeed(expr: Expression, blockedExprs: Expression[] = []): ImmSet<Expression> {
        // Perform a breadth-first search to find all direct or indrirect dependent expressions, not proceeding past any blocked expressions
        let discoveredExprs = ImmSet<Expression>([expr, ...blockedExprs])
        const exprVisitQueue: Expression[] = [expr]
        while (exprVisitQueue.length > 0) {
            // @ts-expect-error Popping from the queue is guaranteed to return an Expression due to the length check above
            const currentExpr: Expression = exprVisitQueue.pop()
            const currentDependentExprs = this.exprToDependentExprs.get(currentExpr) || ImmSet<Expression>()
            currentDependentExprs.forEach(dependentExpr => {
                if (!discoveredExprs.has(dependentExpr)) {
                    discoveredExprs = discoveredExprs.add(dependentExpr)
                    exprVisitQueue.push(dependentExpr)
                }
            })
        }

        // Remove any blocked expressions from the set of discovered expressions before returning
        return discoveredExprs.subtract(blockedExprs)
    }

    getResult<A extends any[], R>(expr: Expression<A, R>): R {
        return this.setActiveAndResolveResult(expr)
    }

    protected setActiveAndResolveResult<A extends any[], R>(expr: Expression<A, R>): R {
        const prevActiveDatabase = activeDatabase
        activeDatabase = this
        try {
            return this.resolveResult(expr)
        } finally {
            activeDatabase = prevActiveDatabase
        }
    }

    protected resolveResult<A extends any[], R>(expr: Expression<A, R>): R {
        // If there is already a cached result for this expression, return it
        const cachedResult = this.exprToCachedResult.get(expr)
        if(cachedResult) {
            const { value, isReturnValue } = cachedResult
            
            // Return the return value or throw the error, depending on which it is
            if(isReturnValue) {
                return value
            } else {
                throw value
            }
        }

        // If there is still no cached result, compute and cache one using the predicate function
        return this.updateExprCacheAndGetResult(expr)
    }

    protected setDeepestComputingExpr(expr: Expression | null): void {
        this.currentDeepestComputingExpr = expr
    }

    protected setResultGetAffectedExprs(expr: Expression, result: ExpressionResult): ImmSet<Expression> {
        let affectedExprs = this.getAllDependentExprsIncludingSeed(expr)

        // Invalidate all affected expressions
        affectedExprs.forEach(affectedExpr => {
            this.invalidateSingleExprResult(affectedExpr)
        })

        // Set the result in the cache
        this.exprToCachedResult = this.exprToCachedResult.set(expr, result)

        return affectedExprs
    }

    /** @internal Only called by module-level `spy`; requires this to already be the active database. */
    recordDependencyAndResolve<A extends any[], R>(expr: Expression<A, R>): R {
        /* If there is a currently computing expression, then that expression must depend on the one
           whose result is being requested. So that dependency should be recorded. */
        if (this.currentDeepestComputingExpr !== null) {
            this.addDependency(this.currentDeepestComputingExpr, expr)
        }

        return this.resolveResult(expr)
    }

    protected updateExprCacheAndGetResult<A extends any[], R>(expr: Expression<A, R>): R {
        /* Compute the result unless we are already computing, in which case
           we throw an error, as this means we are in a recursive call */
        if (this.currentlyComputingExprs.has(expr)) {
            throw new RecursiveExpressionComputationError(expr)
        }

        // Record the previous calling key so it can be restored when we're done
        const prevCallingKey = this.currentDeepestComputingExpr

        /* Mark this expression as the calling expression so that contributing expressions know to
           invalidate this expression when they are updated */
        this.setDeepestComputingExpr(expr)

        /* Mark this expression as currently computing so that we don't
           recursively compute the same expression while calling the function */
        this.currentlyComputingExprs = this.currentlyComputingExprs.add(expr)

        // Compute the result or error
        let gotReturn: boolean
        let result: R | unknown
        try {
            result = expr.pred(...expr.args)
            gotReturn = true
        } catch(err) {
            result = err
            gotReturn = false
        }

        /* Because the function call is done, we can unmark this key as
           currently computing */
        this.currentlyComputingExprs = this.currentlyComputingExprs.delete(expr)

        // Restore the previous calling key
        this.setDeepestComputingExpr(prevCallingKey)

        // Update the cache with the result
        this.exprToCachedResult = this.exprToCachedResult.set(expr, new ExpressionResult(result, gotReturn))

        if(gotReturn) {
            // If there was no error, return the result
            // @ts-expect-error gotReturn being true means that result's type is R, not unknown
            return result
        } else {
            // If there was an error, rethrow it
            throw result
        }
    }

    with<A extends any[], R>(expr: Expression<A, R>, result: R): Database {
        // Return just the new database
        return this.withGetAffectedRels(expr, result)[0]
    }

    withError(expr: Expression, err: any): Database {
        // Return just the new database
        return this.withErrorGetAffectedRels(expr, err)[0]
    }

    withErrorGetAffectedRels(expr: Expression, err: Value): [Database, ImmSet<Expression>] {
        return this.withResultGetAffectedRels(expr, new ExpressionResult(err, false))
    }

    withGetAffectedRels<A extends any[], R>(expr: Expression<A, R>, resVal: R): [Database, ImmSet<Expression>] {
        return this.withResultGetAffectedRels(expr, new ExpressionResult(resVal, true))
    }

    protected withResultGetAffectedRels(expr: Expression, result: ExpressionResult): [Database, ImmSet<Expression>] {
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

    withModified<A extends any[], R>(expr: Expression<A, R>, modifier: (val: R) => R): Database {
        // Return just the new database
        return this.withModifiedGetAffectedRels(expr, modifier)[0]
    }

    withModifiedGetAffectedRels<A extends any[], R>(expr: Expression<A, R>, modifier: (oldResult: R) => R): [Database, ImmSet<Expression>] {
        // The new result is the old result with the modifier function applied to it
        const newResult = modifier(this.getResult(expr))
        return this.withGetAffectedRels(expr, newResult)
    }
}

export function spy<A extends any[], R>(expr: Expression<A, R>): R {
    // Outside of a computation there is no database to track dependencies in,
    // so just evaluate the predicate directly.
    if (activeDatabase === null) {
        return expr.pred(...expr.args)
    }

    return activeDatabase.recordDependencyAndResolve(expr)
}
