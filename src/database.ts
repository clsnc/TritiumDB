import { List as ImmList, Map as ImmMap, Set as ImmSet, is, ValueObject } from "immutable"
import { AsyncCallIncompleteError, asyncCallResult, AsyncCallStatus, asyncCallStatus } from "./async"

export type Value = any

type ExprArgs<P extends (...args: any[]) => any> =
    Parameters<P> extends [Database, ...infer Rest] ? Rest : any[]

export class Expression<P extends (db: Database, ...args: any[]) => any = (db: Database, ...args: any[]) => any> implements ValueObject {
    private readonly _list: ImmList<any>

    constructor(pred: P, args: ExprArgs<P>) {
        this._list = ImmList([pred, ...args])
    }

    get pred(): P { return this._list.get(0) as P }
    get args(): ExprArgs<P> { return this._list.shift().toArray() as ExprArgs<P> }

    hashCode(): number { return this._list.hashCode() }

    equals(other: unknown): boolean {
        return other instanceof Expression && this._list.equals((other as Expression)._list)
    }

    [Symbol.iterator](): Iterator<any> { return this._list[Symbol.iterator]() }
}

export function expr<P extends (db: Database, ...args: any[]) => any>(
    pred: P, ...args: ExprArgs<P>
): Expression<P> {
    return new Expression(pred, args as any)
}

export class DerivativeId implements ValueObject {
    constructor(
        readonly creatingExpr: Expression,
        readonly uniqueKey: any
    ) {}

    hashCode(): number {
        return ImmList([this.creatingExpr, this.uniqueKey]).hashCode()
    }

    equals(other: unknown): boolean {
        return other instanceof DerivativeId
            && this.creatingExpr.equals(other.creatingExpr)
            && is(this.uniqueKey, other.uniqueKey)
    }
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

    getDerivativeId(uniqueKey: any = undefined): DerivativeId {
        if (this.currentDeepestComputingExpr === null) {
            throw new Error("getDerivativeId can only be called during expression computation")
        }

        return new DerivativeId(this.currentDeepestComputingExpr, uniqueKey)
    }

    protected clearExprDependencies(expr: Expression): void {
        // Get the contributing expressions for this expression
        const contributorKeys = this.exprToContributorExprs.get(expr)

        // Remove this expression's contributor relationships
        this.exprToContributorExprs = this.exprToContributorExprs.delete(expr)

        // Remove this expression from each contributor's dependency tracking
        contributorKeys?.forEach(contributorKey => {
            this.exprToDependentExprs = this.exprToDependentExprs.update(contributorKey, dependentKeys => dependentKeys.delete(expr))
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
            const currentExpr = exprVisitQueue.pop()
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

    getResult(expr: Expression): Value {
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

        // Check if any terms in the expression are derivative IDs and recompute their creating expressions if needed
        /* TODO: It is possible for derivative expressions to be set using derivative IDs that were created during the computation 
           of other expressions. In those cases, this will fail to compute the expression needed to set the derivative expression. 
           Some strategy should be figured out to determine what expression actually needs to be recomputed to get the derivative 
           expression to be set. */
        // TODO: Add proper handling and testing for errors thrown here by the creating expression
        for (const term of expr) {
            if (term instanceof DerivativeId) {
                const creatingExpr = term.creatingExpr
                if (!this.exprToCachedResult.has(creatingExpr) && !this.currentlyComputingExprs.has(creatingExpr)) {
                    try {
                        // Recompute the creating expression so it can set the derivative expression
                        this.getResult(creatingExpr)
                    } catch (err) {
                        /* If recomputing the creating expression re-enters the current expression, we still
                           allow this path when the derivative expression has already been set as a side effect. 
                           Otherwise, preserve the original error behavior. */
                        if(err instanceof RecursiveExpressionComputationError && this.exprToCachedResult.has(expr)) {
                            /* Since the current expression now has a cached value, it's possible that the functions that threw 
                               recursion errors will succeed if reevaluated in the future, even without changes to their dependencies. 
                               Because of this, the cached recursion errors should be removed so that those functions will be reevaluated 
                               if called again. Expressions whose caches need to be cleared can be found by starting with the expression 
                               that originally threw the recursion error and working upward through its dependents, stopping at the current 
                               expression. Because those expressions needed to be computed now and were not already cached, they must not 
                               have any pre-existing dependents. So there is no chance of accidentally clearing cached results that 
                               shouldn't be cleared. */
                            const exprsToClearCache = this.getAllDependentExprsIncludingSeed(err.recursiveExpr, [expr])
                            this.exprToCachedResult = this.exprToCachedResult.deleteAll(exprsToClearCache)
                        } else {
                            throw err
                        }
                    }
                }
            }
        }

        // After checking derivative IDs, return the cached result if it exists
        const cachedAfterDerivativeIdCheck = this.exprToCachedResult.get(expr)
        if(cachedAfterDerivativeIdCheck) {
            const { value, isReturnValue } = cachedAfterDerivativeIdCheck

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

    setDerivative<P extends (...args: any[]) => any>(expr: Expression<P>, result: ReturnType<P>): void {
        if (this.currentDeepestComputingExpr === null) {
            throw new Error("setDerivative can only be called during expression computation")
        }

        // Set the result
        /* Any dependencies on this derivative expression should have been invalidated when the setting expression was, 
           so getting affected expressions shouldn't be significant waste of compute. */
        this.setResultGetAffectedExprs(expr, new ExpressionResult(result, true))

        // Mark the derivative expression as dependent on the currently computing expression
        this.addDependency(expr, this.currentDeepestComputingExpr)
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

    spyAsyncEffectResult<Pred extends (...args: any[]) => Promise<any>>(expr: Expression<Pred>): Awaited<ReturnType<Pred>>
    spyAsyncEffectResult(expr: Expression): any
    spyAsyncEffectResult(expr: Expression): any {
        const callStatus = this.spyResult(new Expression(asyncCallStatus, [expr.pred, ...expr.args]))
        if(callStatus === AsyncCallStatus.Complete) {
            // If the async call is complete, return its return value
            return this.spyResult(new Expression(asyncCallResult, [expr.pred, ...expr.args]))
        } else {
            // If the async call is incomplete, throw an error
            throw new AsyncCallIncompleteError(expr)
        }
    }

    spyResult<P extends (...args: any[]) => any>(expr: Expression<P>): ReturnType<P>
    spyResult(expr: Expression): any
    spyResult(expr: Expression): any {
        /* If there is a currently computing expression, then that expression must depend on the one 
           whose result is being requested. So that dependency should be recorded. */
        if (this.currentDeepestComputingExpr !== null) {
            this.addDependency(this.currentDeepestComputingExpr, expr)
        }

        return this.getResult(expr)
    }

    protected updateExprCacheAndGetResult(expr: Expression): any {
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
        let result
        try {
            result = expr.pred(this, ...expr.args)
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
            return result
        } else {
            // If there was an error, rethrow it
            throw result
        }
    }

    with<P extends (...args: any[]) => any>(expr: Expression<P>, result: ReturnType<P>): Database {
        // Return just the new database
        return this.withGetAffectedRels(expr, result)[0]
    }

    withError<P extends (...args: any[]) => any>(expr: Expression<P>, err: any): Database {
        // Return just the new database
        return this.withErrorGetAffectedRels(expr, err)[0]
    }

    withErrorGetAffectedRels(expr: Expression, err: Value): [Database, ImmSet<Expression>] {
        return this.withResultGetAffectedRels(expr, new ExpressionResult(err, false))
    }

    withGetAffectedRels<P extends (...args: any[]) => any>(expr: Expression<P>, resVal: ReturnType<P>): [Database, ImmSet<Expression>] {
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

    withModified<P extends (...args: any[]) => any>(expr: Expression<P>, modifier: (val: ReturnType<P>) => ReturnType<P>): Database {
        // Return just the new database
        return this.withModifiedGetAffectedRels(expr, modifier)[0]
    }

    withModifiedGetAffectedRels<P extends (...args: any[]) => any>(expr: Expression<P>, modifier: (oldResult: ReturnType<P>) => ReturnType<P>): [Database, ImmSet<Expression>] {
        // The new result is the old result with the modifier function applied to it
        const newResult = modifier(this.getResult(expr))
        return this.withGetAffectedRels(expr, newResult)
    }
}
