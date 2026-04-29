import { describe, it, expect, vi } from 'vitest'
import { Database, DerivativeId, RecursiveExpressionComputationError, expr } from './database'

describe('ReactiveDatabase', () => {
  it('creates a ReactiveDatabase instance', () => {
    const rdb = new Database()

    expect(rdb).toBeInstanceOf(Database)
  })

  it('computes result for function predicates', () => {
    const rdb = new Database()
    const func = vi.fn((db, arg) => `computed-${arg}`)
    const e = expr(func, 'test-arg')

    const result = rdb.getResult(e)
    expect(result).toBe('computed-test-arg')
    expect(func).toHaveBeenCalledWith(rdb, 'test-arg')
  })

  it('throws RecursiveExpressionComputationError for recursive computation of the same expression', () => {
    const rdb = new Database()
    let recursiveCallCount = 0

    const recursiveFunc = (db: Database, arg: string): string => {
      recursiveCallCount++
      if (recursiveCallCount === 1) {
        // First call, trigger recursion
        return db.spyResult(expr(recursiveFunc, arg))
      }
      return 'result'
    }

    const recursiveExpr = expr(recursiveFunc, 'test')

    let thrown
    try {
      rdb.getResult(recursiveExpr)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RecursiveExpressionComputationError)
    expect((thrown as RecursiveExpressionComputationError).recursiveExpr.equals(recursiveExpr)).toBe(true)
    expect(recursiveCallCount).toBe(1)
  })

  it('creates immutable database with with() method', () => {
    const rdb = new Database()
    const testPred = (_db: Database, _arg: string): any => undefined
    const e = expr(testPred, 'arg')
    const result = 'test-result'

    const newDb = rdb.with(e, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(newDb).not.toBe(rdb) // Should be a new instance
    expect(newDb.getResult(e)).toBe(result)
    expect(rdb.getResult(e)).toBeUndefined() // Original unchanged
  })

  it('returns affected expressions with withGetAffectedRels()', () => {
    const rdb = new Database()
    const testPred = (_db: Database, _arg: string): any => undefined
    const e = expr(testPred, 'arg')
    const result = 'test-result'

    const [newDb, affectedExprs] = rdb.withGetAffectedRels(e, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(affectedExprs.has(e)).toBe(true)
    expect(newDb.getResult(e)).toBe(result)
  })

  it('creates immutable database with withError()', () => {
    const rdb = new Database()
    const errPred = (_db: Database, _arg: string): any => undefined
    const e = expr(errPred, 'arg')
    const err = new Error('bad')

    const newDb = rdb.withError(e, err)

    expect(newDb).toBeInstanceOf(Database)
    expect(newDb).not.toBe(rdb)
    expect(() => newDb.getResult(e)).toThrow(err)
    expect(rdb.getResult(e)).toBeUndefined()
  })

  it('returns affected expressions with withErrorGetAffectedRels()', () => {
    const rdb = new Database()
    const errPred = (_db: Database, _arg: string): any => undefined
    const e = expr(errPred, 'arg')
    const err = new Error('bad')

    const [newDb, affectedExprs] = rdb.withErrorGetAffectedRels(e, err)

    expect(newDb).toBeInstanceOf(Database)
    expect(affectedExprs.has(e)).toBe(true)
    expect(() => newDb.getResult(e)).toThrow(err)
  })

  it('allows values to depend on other values', () => {
    const rdb = new Database()

    // Create a base expression
    const base = (_db: Database): any => undefined
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'base-value')

    // Create a dependent expression that uses the base
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    const result = db1.getResult(dependentExpr)
    expect(result).toBe('dependent-base-value')
  })

  it('invalidates dependent expressions when base expression changes', () => {
    const rdb = new Database()

    // Set up base expression
    const base = (_db: Database): any => undefined
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'value1')

    // Create dependent expression
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    // Compute dependent result
    const result1 = db1.getResult(dependentExpr)
    expect(result1).toBe('dependent-value1')

    // Update base expression
    const db2 = db1.with(baseExpr, 'value2')

    // Dependent should be recomputed with new base value
    const result2 = db2.getResult(dependentExpr)
    expect(result2).toBe('dependent-value2')
  })

  it('handles complex dependency graphs', () => {
    const rdb = new Database()

    // Base expressions
    const base1Pred = (_db: Database): any => undefined
    const base2Pred = (_db: Database): any => undefined
    const base1 = expr(base1Pred)
    const base2 = expr(base2Pred)

    // Set base values
    let db = rdb.with(base1, 'value1').with(base2, 'value2')

    // Dependent expressions
    const func1 = (db: Database) => {
      const val1 = db.spyResult(base1)
      return `func1-${val1}`
    }
    const func2 = (db: Database) => {
      const val2 = db.spyResult(base2)
      return `func2-${val2}`
    }
    const func3 = (db: Database) => {
      const val1 = db.spyResult(expr(func1))
      const val2 = db.spyResult(expr(func2))
      return `func3-${val1}-${val2}`
    }

    const dependent1 = expr(func1)
    const dependent2 = expr(func2)
    const dependent3 = expr(func3)

    // Test initial computation
    expect(db.getResult(dependent1)).toBe('func1-value1')
    expect(db.getResult(dependent2)).toBe('func2-value2')
    expect(db.getResult(dependent3)).toBe('func3-func1-value1-func2-value2')

    // Update base1 and check propagation
    db = db.with(base1, 'new-value1')
    expect(db.getResult(dependent1)).toBe('func1-new-value1')
    expect(db.getResult(dependent2)).toBe('func2-value2') // Should be unchanged
    expect(db.getResult(dependent3)).toBe('func3-func1-new-value1-func2-value2')
  })

  it('maintains immutability when creating new instances', () => {
    const rdb = new Database()
    const testPred = (_db: Database): any => undefined
    const e = expr(testPred)

    const db1 = rdb.with(e, 'value1')
    const db2 = db1.with(e, 'value2')

    // Each database should have its own state
    expect(rdb.getResult(e)).toBeUndefined()
    expect(db1.getResult(e)).toBe('value1')
    expect(db2.getResult(e)).toBe('value2')

    // Original databases should be unchanged
    expect(db1.getResult(e)).toBe('value1')
  })

  it('handles function expressions with multiple arguments', () => {
    const rdb = new Database()
    const func = vi.fn((db, arg1, arg2, arg3) => `${arg1}-${arg2}-${arg3}`)
    const e = expr(func, 'a', 'b', 'c')

    const result = rdb.getResult(e)
    expect(result).toBe('a-b-c')
    expect(func).toHaveBeenCalledWith(rdb, 'a', 'b', 'c')
  })

  it('caches computed results for function expressions', () => {
    const rdb = new Database()
    let callCount = 0

    const func = (db: Database, arg: string) => {
      callCount++
      return `computed-${arg}-${callCount}`
    }
    const e = expr(func, 'test')

    // First call should compute
    const result1 = rdb.getResult(e)
    expect(result1).toBe('computed-test-1')
    expect(callCount).toBe(1)

    // Second call should use cache
    const result2 = rdb.getResult(e)
    expect(result2).toBe('computed-test-1') // Same result as first call
    expect(callCount).toBe(1) // Function not called again
  })

  it('demonstrates reactive behavior with cascading updates', () => {
    const rdb = new Database()

    // Create a chain of dependent expressions
    const counter = (_db: Database): any => undefined
    const baseExpr = expr(counter)
    const doubleFunc = (db: Database) => {
      const count = db.spyResult(baseExpr) || 0
      return count * 2
    }
    const doubleExpr = expr(doubleFunc)

    const quadrupleFunc = (db: Database) => {
      const doubled = db.spyResult(doubleExpr)
      return doubled * 2
    }
    const quadrupleExpr = expr(quadrupleFunc)

    // Initial state
    let db = rdb.with(baseExpr, 5)
    expect(db.getResult(doubleExpr)).toBe(10)
    expect(db.getResult(quadrupleExpr)).toBe(20)

    // Update base value
    db = db.with(baseExpr, 10)
    expect(db.getResult(doubleExpr)).toBe(20)
    expect(db.getResult(quadrupleExpr)).toBe(40)
  })

  it('throws error when getDerivativeId is called outside computation', () => {
    const rdb = new Database()

    expect(() => {
      rdb.getDerivativeId('test-key')
    }).toThrow('getDerivativeId can only be called during expression computation')
  })

  it('throws error when setDerivative is called outside computation', () => {
    const rdb = new Database()
    const testPred = (_db: Database): any => undefined

    expect(() => {
      rdb.setDerivative(expr(testPred), 'value')
    }).toThrow('setDerivative can only be called during expression computation')
  })

  it('allows basic usage of getDerivativeId and setDerivative during computation', () => {
    const rdb = new Database()
    const derivPred = (_db: Database, _id: DerivativeId): any => undefined

    const createDerivativeFunc = (db: Database) => {
      const derivativeId = db.getDerivativeId('my-key')
      db.setDerivative(expr(derivPred, derivativeId), 'derivative-value')
      return derivativeId
    }

    const creatingExpr = expr(createDerivativeFunc)
    const createdDerivativeId = rdb.getResult(creatingExpr)

    expect(createdDerivativeId).toBeInstanceOf(DerivativeId)
    expect(createdDerivativeId.creatingExpr.equals(creatingExpr)).toBe(true)
    expect(createdDerivativeId.uniqueKey).toBe('my-key')

    // The derivative expression should be accessible
    const derivativeExpr = expr(derivPred, createdDerivativeId)
    expect(rdb.getResult(derivativeExpr)).toBe('derivative-value')
  })

  it('returns consistent DerivativeId for same uniqueKey in same function with same args', () => {
    const rdb = new Database()

    const createDerivativeFunc = (db: Database, arg: string) => {
      const id1 = db.getDerivativeId('same-key')
      const id2 = db.getDerivativeId('same-key')
      return [id1, id2]
    }

    const e = expr(createDerivativeFunc, 'test-arg')
    const [id1, id2] = rdb.getResult(e)

    expect(id1).toEqual(id2)
    expect(id1.creatingExpr.equals(e)).toBe(true)
    expect(id1.uniqueKey).toBe('same-key')
  })

  it('returns different DerivativeIds for different uniqueKeys or different args', () => {
    const rdb = new Database()

    const createDerivativeFunc = (db: Database, arg: string) => {
      const id1 = db.getDerivativeId('key1')
      const id2 = db.getDerivativeId('key2')
      return [id1, id2]
    }

    const e1 = expr(createDerivativeFunc, 'arg1')
    const e2 = expr(createDerivativeFunc, 'arg2')

    const [id1a, id1b] = rdb.getResult(e1)
    const [id2a, id2b] = rdb.getResult(e2)

    expect(id1a).not.toEqual(id1b) // different keys
    expect(id1a).not.toEqual(id2a) // different expressions
    expect(id1a.uniqueKey).toBe('key1')
    expect(id1b.uniqueKey).toBe('key2')
    expect(id2a.uniqueKey).toBe('key1')
  })

  it('invalidates derivative expressions when creating expression is invalidated', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined
    const derivPred = (_db: Database, _id: DerivativeId, _val: string): any => undefined

    // Base expression that the creating function depends on
    const baseExpr = expr(base)
    let db = rdb.with(baseExpr, 'initial')

    const createDerivativeFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('dependent-key')
      db.setDerivative(expr(derivPred, derivativeId, baseValue), `value-${baseValue}`)
      return derivativeId
    }

    const creatingExpr = expr(createDerivativeFunc)
    const derivativeId = db.getResult(creatingExpr)
    const derivativeExpr = expr(derivPred, derivativeId, 'initial')

    expect(db.getResult(derivativeExpr)).toBe('value-initial')

    // Update base expression, which should invalidate the creating expression and thus the derivative
    db = db.with(baseExpr, 'updated')

    // Creating expression should be recomputed with new base value
    const newDerivativeId = db.getResult(creatingExpr)
    const newDerivativeExpr = expr(derivPred, newDerivativeId, 'updated')
    expect(db.getResult(newDerivativeExpr)).toBe('value-updated')
  })

  it('expression results can depend on derivative expression results', () => {
    const rdb = new Database()
    const derivPred = (_db: Database, _id: DerivativeId): any => undefined

    const createDerivativeFunc = (db: Database) => {
      const derivativeId = db.getDerivativeId('test-key')
      db.setDerivative(expr(derivPred, derivativeId), 'computed-value')
      return derivativeId
    }

    const creatingExpr = expr(createDerivativeFunc)
    const derivativeId = rdb.getResult(creatingExpr)

    // Create an expression that uses the DerivativeId
    const usingFunc = (db: Database) => {
      const derivativeValue = db.spyResult(expr(derivPred, derivativeId))
      return `using-${derivativeValue}`
    }

    const usingExpr = expr(usingFunc)
    const result = rdb.getResult(usingExpr)

    expect(result).toBe('using-computed-value')
  })

  it('handles multiple derivative expressions created within same computation', () => {
    const rdb = new Database()
    const deriv1Pred = (_db: Database, _id: DerivativeId): any => undefined
    const deriv2Pred = (_db: Database, _id: DerivativeId): any => undefined

    const createMultipleDerivativesFunc = (db: Database) => {
      const id1 = db.getDerivativeId('key1')
      const id2 = db.getDerivativeId('key2')

      db.setDerivative(expr(deriv1Pred, id1), 'value1')
      db.setDerivative(expr(deriv2Pred, id2), 'value2')

      return [id1, id2]
    }

    const e = expr(createMultipleDerivativesFunc)
    const [id1, id2] = rdb.getResult(e)

    expect(rdb.getResult(expr(deriv1Pred, id1))).toBe('value1')
    expect(rdb.getResult(expr(deriv2Pred, id2))).toBe('value2')
  })

  it('handles derivative expressions that contain other DerivativeIds', () => {
    const rdb = new Database()
    const level1Pred = (_db: Database, _id: DerivativeId): any => undefined
    const level2Pred = (_db: Database, _id: DerivativeId, _id2: DerivativeId): any => undefined

    const createNestedDerivativesFunc = (db: Database) => {
      const id1 = db.getDerivativeId('level1')
      const id2 = db.getDerivativeId('level2')

      db.setDerivative(expr(level1Pred, id1), 'value1')
      db.setDerivative(expr(level2Pred, id2, id1), 'value2-with-id1')

      return [id1, id2]
    }

    const e = expr(createNestedDerivativesFunc)
    const [id1, id2] = rdb.getResult(e)

    expect(rdb.getResult(expr(level1Pred, id1))).toBe('value1')
    expect(rdb.getResult(expr(level2Pred, id2, id1))).toBe('value2-with-id1')
  })

  it('regular expressions can depend on derivative expressions set within their own computation', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined
    const derivedExprPred = (_db: Database, _id: DerivativeId): any => undefined

    // Create a base expression
    const baseExpr = expr(base)
    let db = rdb.with(baseExpr, 'base-value')

    // Create a combined function that creates a derivative expression and also depends on it
    const combinedFunc = (db: Database) => {
      // Create the derivative
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('derived')
      db.setDerivative(expr(derivedExprPred, derivativeId), `derived-${baseValue}`)

      // Now depend on the derivative
      const derivedValue = db.spyResult(expr(derivedExprPred, derivativeId))
      return `dependent-${derivedValue}`
    }

    const combinedExpr = expr(combinedFunc)
    const result = db.getResult(combinedExpr)

    expect(result).toBe('dependent-derived-base-value')

    // Update base expression and verify invalidation propagates
    db = db.with(baseExpr, 'new-base-value')
    const newResult = db.getResult(combinedExpr)
    expect(newResult).toBe('dependent-derived-new-base-value')
  })

  it('handles A -> B -> C dependencies when A creates a derivative ID and sets an expression with it, C depends on that expression, and C is evaluated before A', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined
    const derivedExprPred = (_db: Database, _id: DerivativeId): any => undefined

    const baseExpr = expr(base)
    let db = rdb.with(baseExpr, 'base-value')
    let storedDerivativeId: DerivativeId | undefined

    const predicateC = (db: Database, derivativeId: DerivativeId) => {
      return db.spyResult(expr(derivedExprPred, derivativeId))
    }

    const predicateB = (db: Database, derivativeId: DerivativeId) => {
      return db.spyResult(expr(predicateC, derivativeId))
    }

    const predicateA = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('through-predicate-c')
      storedDerivativeId = derivativeId

      db.setDerivative(expr(derivedExprPred, derivativeId), `derived-${baseValue}`)

      return db.spyResult(expr(predicateB, derivativeId))
    }

    const exprA = expr(predicateA)

    expect(db.getResult(exprA)).toBe('derived-base-value')

    // Try changing the base value and calling exprA again
    db = db.with(baseExpr, 'base-value-2')
    expect(db.getResult(exprA)).toBe('derived-base-value-2')
    
    // Try changing the base value and calling the predicate chain from B first
    db = db.with(baseExpr, 'base-value-3')
    // @ts-expect-error As this is part of an assertion, it doesn't matter if storedDerivativeId arrives undefined
    expect(db.getResult(expr(predicateC, storedDerivativeId))).toBe('derived-base-value-3')
    // @ts-expect-error As this is part of an assertion, it doesn't matter if storedDerivativeId arrives undefined
    expect(db.getResult(expr(predicateB, storedDerivativeId))).toBe('derived-base-value-3')
    expect(db.getResult(exprA)).toBe('derived-base-value-3')
  })

  it('derivative expressions can depend on regular expressions', () => {
    const rdb = new Database()
    const base1Pred = (_db: Database): any => undefined
    const base2Pred = (_db: Database): any => undefined
    const combinedPred = (_db: Database, _id: DerivativeId): any => undefined

    // Create base expressions
    const base1 = expr(base1Pred)
    const base2 = expr(base2Pred)
    let db = rdb.with(base1, 'value1').with(base2, 'value2')

    // Create a function that creates a derivative depending on regular expressions
    const createDerivativeFunc = (db: Database) => {
      const val1 = db.spyResult(base1)
      const val2 = db.spyResult(base2)
      const derivativeId = db.getDerivativeId('combined')
      db.setDerivative(expr(combinedPred, derivativeId), `${val1}-${val2}`)
      return derivativeId
    }

    const creatingExpr = expr(createDerivativeFunc)

    // Create a function that accesses the derivative
    const accessDerivativeFunc = (db: Database) => {
      const derivativeId = db.spyResult(creatingExpr)
      return db.spyResult(expr(combinedPred, derivativeId))
    }

    const accessExpr = expr(accessDerivativeFunc)
    expect(db.getResult(accessExpr)).toBe('value1-value2')

    // Update base1 and verify derivative is recomputed
    db = db.with(base1, 'new-value1')
    expect(db.getResult(accessExpr)).toBe('new-value1-value2')
  })

  it('handles complex dependency chains involving derivatives', () => {
    const rdb = new Database()
    const baseAPred = (_db: Database): any => undefined
    const baseBPred = (_db: Database): any => undefined
    const level2ExprPred = (_db: Database, _id: DerivativeId): any => undefined

    // Base expressions
    const baseA = expr(baseAPred)
    const baseB = expr(baseBPred)
    let db = rdb.with(baseA, 'A').with(baseB, 'B')

    // Level 1: Regular expression depending on base
    const level1Func = (db: Database) => {
      const a = db.spyResult(baseA)
      return `level1-${a}`
    }
    const level1Expr = expr(level1Func)

    // Level 2: Derivative depending on level 1
    const level2Func = (db: Database) => {
      const l1 = db.spyResult(level1Expr)
      const derivativeId = db.getDerivativeId('level2')
      db.setDerivative(expr(level2ExprPred, derivativeId), `level2-${l1}`)
      return derivativeId
    }
    const level2Expr = expr(level2Func)

    // Level 3: Regular expression depending on level 2 derivative
    const level3Func = (db: Database) => {
      const derivativeId = db.spyResult(level2Expr)
      const l2 = db.spyResult(expr(level2ExprPred, derivativeId))
      return `level3-${l2}`
    }
    const level3Expr = expr(level3Func)

    // Test initial state
    expect(db.getResult(level3Expr)).toBe('level3-level2-level1-A')

    // Update baseA and verify full chain recomputes
    db = db.with(baseA, 'new-A')
    expect(db.getResult(level3Expr)).toBe('level3-level2-level1-new-A')
  })

  it('multiple expressions can depend on the same derivative', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined
    const sharedDerivPred = (_db: Database, _id: DerivativeId): any => undefined

    // Create a base value that the derivative depends on
    const baseExpr = expr(base)
    let db = rdb.with(baseExpr, 'initial')

    const createDerivativeFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('shared')
      db.setDerivative(expr(sharedDerivPred, derivativeId), `shared-${baseValue}`)
      return derivativeId
    }

    const creatingExpr = expr(createDerivativeFunc)

    // Create multiple dependent expressions that get the current derivativeId
    const dep1Func = (db: Database) => {
      const currentId = db.spyResult(creatingExpr)
      const value = db.spyResult(expr(sharedDerivPred, currentId))
      return `dep1-${value}`
    }
    const dep2Func = (db: Database) => {
      const currentId = db.spyResult(creatingExpr)
      const value = db.spyResult(expr(sharedDerivPred, currentId))
      return `dep2-${value}`
    }
    const dep3Func = (db: Database) => {
      const currentId = db.spyResult(creatingExpr)
      const value = db.spyResult(expr(sharedDerivPred, currentId))
      return `dep3-${value}`
    }

    const dep1Expr = expr(dep1Func)
    const dep2Expr = expr(dep2Func)
    const dep3Expr = expr(dep3Func)

    expect(db.getResult(dep1Expr)).toBe('dep1-shared-initial')
    expect(db.getResult(dep2Expr)).toBe('dep2-shared-initial')
    expect(db.getResult(dep3Expr)).toBe('dep3-shared-initial')

    // Change the base value and verify all dependents update
    db = db.with(baseExpr, 'updated')
    expect(db.getResult(dep1Expr)).toBe('dep1-shared-updated')
    expect(db.getResult(dep2Expr)).toBe('dep2-shared-updated')
    expect(db.getResult(dep3Expr)).toBe('dep3-shared-updated')
  })

  it('derivatives can depend on other derivatives in a chain', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined
    const firstPred = (_db: Database, _id: DerivativeId): any => undefined
    const secondPred = (_db: Database, _id: DerivativeId): any => undefined
    const thirdPred = (_db: Database, _id: DerivativeId): any => undefined

    // Create a base value that the first derivative depends on
    const baseExpr = expr(base)
    let db = rdb.with(baseExpr, 'initial')

    // Expression A: creates first derivative depending on base
    const createFirstFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const id1 = db.getDerivativeId('first')
      db.setDerivative(expr(firstPred, id1), `first-${baseValue}`)
      return id1
    }
    const exprA = expr(createFirstFunc)

    // Expression B: creates second derivative depending on first
    const createSecondFunc = (db: Database) => {
      const id1 = db.spyResult(exprA)
      const firstValue = db.spyResult(expr(firstPred, id1))
      const id2 = db.getDerivativeId('second')
      db.setDerivative(expr(secondPred, id2), `second-${firstValue}`)
      return id2
    }
    const exprB = expr(createSecondFunc)

    // Expression C: creates third derivative depending on second
    const createThirdFunc = (db: Database) => {
      const id2 = db.spyResult(exprB)
      const secondValue = db.spyResult(expr(secondPred, id2))
      const id3 = db.getDerivativeId('third')
      db.setDerivative(expr(thirdPred, id3), `third-${secondValue}`)
      return id3
    }
    const exprC = expr(createThirdFunc)

    const id3 = db.getResult(exprC)
    expect(db.getResult(expr(thirdPred, id3))).toBe('third-second-first-initial')
    expect(db.getResult(expr(secondPred, db.getResult(exprB)))).toBe('second-first-initial')
    expect(db.getResult(expr(firstPred, db.getResult(exprA)))).toBe('first-initial')

    // Change the base value and verify the entire chain updates
    db = db.with(baseExpr, 'changed')
    const newId3 = db.getResult(exprC)
    expect(db.getResult(expr(thirdPred, newId3))).toBe('third-second-first-changed')
    expect(db.getResult(expr(secondPred, db.getResult(exprB)))).toBe('second-first-changed')
    expect(db.getResult(expr(firstPred, db.getResult(exprA)))).toBe('first-changed')
  })

  it('old derivative expressions are unset when creating expression recomputes', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined
    const derivPred = (_db: Database, _id: DerivativeId, _val: string): any => undefined

    // Create a base value
    const baseExpr = expr(base)
    let db = rdb.with(baseExpr, 'initial')

    // Create a function that produces a derivative depending on the base value
    const createDerivativeFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('dependent')
      db.setDerivative(expr(derivPred, derivativeId, baseValue), `value-${baseValue}`)
      return derivativeId
    }

    const creatingExpr = expr(createDerivativeFunc)
    const derivativeId = db.getResult(creatingExpr)

    // Access the derivative expression
    const oldDerivativeExpr = expr(derivPred, derivativeId, 'initial')
    expect(db.getResult(oldDerivativeExpr)).toBe('value-initial')

    // Change the base value
    db = db.with(baseExpr, 'changed')

    // The new derivative expression should be accessible
    const newDerivativeExpr = expr(derivPred, derivativeId, 'changed')
    expect(db.getResult(newDerivativeExpr)).toBe('value-changed')

    // The old derivative expression should have been invalidated and not replaced
    expect(db.getResult(oldDerivativeExpr)).toBeUndefined()
  })

  it('withModified creates new database with modified expression result', () => {
    const rdb = new Database()
    const testPred = (_db: Database, _arg: string): any => undefined
    const e = expr(testPred, 'arg')
    const initialResult = 'initial-value'

    // Set initial value
    const db1 = rdb.with(e, initialResult)

    // Modify the expression using withModified
    const modifier = (oldVal: any) => `modified-${oldVal}`
    const db2 = db1.withModified(e, modifier)

    expect(db2).toBeInstanceOf(Database)
    expect(db2).not.toBe(db1) // Should be a new instance
    expect(db1.getResult(e)).toBe(initialResult) // Original unchanged
    expect(db2.getResult(e)).toBe('modified-initial-value') // Modified in new db
  })

  it('withModifiedGetAffectedRels returns affected expressions', () => {
    const rdb = new Database()
    const testPred = (_db: Database, _arg: string): any => undefined
    const e = expr(testPred, 'arg')
    const initialResult = 'initial-value'

    // Set initial value
    const db1 = rdb.with(e, initialResult)

    // Modify the expression using withModifiedGetAffectedRels
    const modifier = (oldVal: any) => `modified-${oldVal}`
    const [db2, affectedExprs] = db1.withModifiedGetAffectedRels(e, modifier)

    expect(db2).toBeInstanceOf(Database)
    expect(affectedExprs.has(e)).toBe(true)
    expect(db2.getResult(e)).toBe('modified-initial-value')
  })

  it('withModified invalidates dependent expressions', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined

    // Set up base expression
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'original')

    // Create dependent expression
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    // Compute dependent result
    const result1 = db1.getResult(dependentExpr)
    expect(result1).toBe('dependent-original')

    // Modify base expression using withModified
    const modifier = (oldVal: any) => `${oldVal}-modified`
    const db2 = db1.withModified(baseExpr, modifier)

    // Dependent should be recomputed with new base value
    const result2 = db2.getResult(dependentExpr)
    expect(result2).toBe('dependent-original-modified')
  })

  it('withModified handles undefined initial values', () => {
    const rdb = new Database()
    const nonexistent = (_db: Database): any => undefined
    const e = expr(nonexistent)

    // Modify an expression that doesn't have a result (undefined)
    const modifier = (oldVal: any) => oldVal === undefined ? 'default-value' : `modified-${oldVal}`
    const db2 = rdb.withModified(e, modifier)

    expect(db2.getResult(e)).toBe('default-value')
  })

  it('withModifiedGetAffectedRels includes dependent expressions in affected set', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined

    // Set up base expression
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'original')

    // Create dependent expression
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    // Compute dependent to establish dependency
    db1.getResult(dependentExpr)

    // Modify base expression and get affected expressions
    const modifier = (oldVal: any) => `${oldVal}-modified`
    const [db2, affectedExprs] = db1.withModifiedGetAffectedRels(baseExpr, modifier)

    // Both base and dependent expressions should be affected
    expect(affectedExprs.has(baseExpr)).toBe(true)
    expect(affectedExprs.has(dependentExpr)).toBe(true)
  })

  it('withModified maintains immutability across multiple modifications', () => {
    const rdb = new Database()
    const counter = (_db: Database): any => undefined
    const e = expr(counter)

    const db1 = rdb.with(e, 0)
    const db2 = db1.withModified(e, val => val + 1)
    const db3 = db2.withModified(e, val => val * 2)
    const db4 = db3.withModified(e, val => val - 3)

    // Each database should have its own state
    expect(rdb.getResult(e)).toBeUndefined()
    expect(db1.getResult(e)).toBe(0)
    expect(db2.getResult(e)).toBe(1)
    expect(db3.getResult(e)).toBe(2)
    expect(db4.getResult(e)).toBe(-1)

    // Original databases should be unchanged
    expect(db1.getResult(e)).toBe(0)
    expect(db2.getResult(e)).toBe(1)
    expect(db3.getResult(e)).toBe(2)
  })

  it('caches and rethrows the same error instance', () => {
    const db = new Database()
    const throwingFunc = vi.fn(() => {
      throw new Error('boom')
    })

    const e = expr(throwingFunc)

    let firstError
    try {
      db.getResult(e)
    } catch (err) {
      firstError = err
    }

    let secondError
    try {
      db.getResult(e)
    } catch (err) {
      secondError = err
    }

    expect(firstError instanceof Error)
    expect((firstError as Error).message).toEqual('boom')
    expect(secondError).toBe(firstError)
    expect(throwingFunc).toHaveBeenCalledTimes(1)
  })

  it('invalidates cached errors when dependencies change', () => {
    const db = new Database()
    const base = (_db: Database): any => undefined
    const baseExpr = expr(base)
    const throwingFunc = vi.fn((db: Database) => {
      const value = db.spyResult(baseExpr)
      if (value === 'bad') {
        throw new Error('bad')
      }
      return `ok-${value}`
    })

    const e = expr(throwingFunc)
    const db2 = db.with(baseExpr, 'bad')

    let firstError
    try {
      db2.getResult(e)
    } catch (err) {
      firstError = err
    }

    let secondError
    try {
      db2.getResult(e)
    } catch (err) {
      secondError = err
    }

    expect(firstError).toBeInstanceOf(Error)
    expect(secondError).toBe(firstError)
    expect(throwingFunc).toHaveBeenCalledTimes(1)

    const db3 = db2.with(baseExpr, 'good')
    expect(db3.getResult(e)).toBe('ok-good')
    expect(throwingFunc).toHaveBeenCalledTimes(2)
  })

  it('propagates errors set by withError to dependent expressions', () => {
    const db = new Database()
    const base = (_db: Database): any => undefined
    const baseExpr = expr(base)
    const dependentFunc = vi.fn((db: Database) => `dep-${db.spyResult(baseExpr)}`)
    const dependentExpr = expr(dependentFunc)

    const db1 = db.with(baseExpr, 'ok')
    expect(db1.getResult(dependentExpr)).toBe('dep-ok')
    expect(dependentFunc).toHaveBeenCalledTimes(1)

    const err = new Error('boom')
    const db2 = db1.withError(baseExpr, err)

    expect(() => db2.getResult(baseExpr)).toThrow(err)
    expect(() => db2.getResult(dependentExpr)).toThrow(err)
    expect(dependentFunc).toHaveBeenCalledTimes(2)

    const db3 = db2.with(baseExpr, 'recover')
    expect(db3.getResult(dependentExpr)).toBe('dep-recover')
    expect(dependentFunc).toHaveBeenCalledTimes(3)
  })

  it('allows dependent predicates to catch errors', () => {
    const db = new Database()
    const base = (_db: Database): any => undefined
    const baseExpr = expr(base)
    const innerError = new Error('inner')
    const innerFunc = vi.fn((db: Database) => {
      const value = db.spyResult(baseExpr)
      if (value === 'bad') {
        throw innerError
      }
      return `inner-${value}`
    })
    const outerFunc = vi.fn((db: Database) => {
      try {
        return `outer-${db.spyResult(expr(innerFunc))}`
      } catch (err) {
        return 'outer-fallback'
      }
    })

    const db2 = db.with(baseExpr, 'good')
    expect(db2.getResult(expr(outerFunc))).toBe('outer-inner-good')

    const db3 = db2.with(baseExpr, 'bad')
    expect(db3.getResult(expr(outerFunc))).toBe('outer-fallback')
    expect(innerFunc).toHaveBeenCalledTimes(2)
  })

  it('propagates errors through dependent expressions', () => {
    const rdb = new Database()
    const base = (_db: Database): any => undefined
    const baseExpr = expr(base)
    const innerError = new Error('inner')
    const innerFunc = vi.fn((db: Database) => {
      const value = db.spyResult(baseExpr)
      if (value === 'bad') {
        throw innerError
      }
      return `inner-${value}`
    })
    const outerFunc = vi.fn((db: Database) => `outer-${db.spyResult(expr(innerFunc))}`)

    let db = rdb.with(baseExpr, 'bad')
    let caughtError
    try {
      db.getResult(expr(outerFunc))
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBe(innerError)

    let cachedError
    try {
      db.getResult(expr(outerFunc))
    } catch (err) {
      cachedError = err
    }

    expect(cachedError).toBe(innerError)

    db = db.with(baseExpr, 'good')
    expect(db.getResult(expr(outerFunc))).toBe('outer-inner-good')
    expect(innerFunc).toHaveBeenCalledTimes(2)
  })
})
