import { describe, it, expect, vi } from 'vitest'
import { Database, RecursiveExpressionComputationError, spy } from './database'
import { expr } from './expression'

describe('ReactiveDatabase', () => {
  it('creates a ReactiveDatabase instance', () => {
    const rdb = new Database()

    expect(rdb).toBeInstanceOf(Database)
  })

  it('computes result for function predicates', () => {
    const rdb = new Database()
    const func = vi.fn((arg) => `computed-${arg}`)
    const e = expr(func, 'test-arg')

    const result = rdb.getResult(e)
    expect(result).toBe('computed-test-arg')
    expect(func).toHaveBeenCalledWith('test-arg')
  })

  it('throws RecursiveExpressionComputationError for recursive computation of the same expression', () => {
    const rdb = new Database()
    let recursiveCallCount = 0

    const recursiveFunc = (arg: string): string => {
      recursiveCallCount++
      if (recursiveCallCount === 1) {
        // First call, trigger recursion
        return spy(expr(recursiveFunc, arg))
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
    const testPred = (_arg: string): any => undefined
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
    const testPred = (_arg: string): any => undefined
    const e = expr(testPred, 'arg')
    const result = 'test-result'

    const [newDb, affectedExprs] = rdb.withGetAffectedRels(e, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(affectedExprs.has(e)).toBe(true)
    expect(newDb.getResult(e)).toBe(result)
  })

  it('creates immutable database with withError()', () => {
    const rdb = new Database()
    const errPred = (_arg: string): any => undefined
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
    const errPred = (_arg: string): any => undefined
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
    const base = (): any => undefined
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'base-value')

    // Create a dependent expression that uses the base
    const dependentFunc = () => {
      const baseValue = spy(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    const result = db1.getResult(dependentExpr)
    expect(result).toBe('dependent-base-value')
  })

  it('invalidates dependent expressions when base expression changes', () => {
    const rdb = new Database()

    // Set up base expression
    const base = (): any => undefined
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'value1')

    // Create dependent expression
    const dependentFunc = () => {
      const baseValue = spy(baseExpr)
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
    const base1Pred = (): any => undefined
    const base2Pred = (): any => undefined
    const base1 = expr(base1Pred)
    const base2 = expr(base2Pred)

    // Set base values
    let db = rdb.with(base1, 'value1').with(base2, 'value2')

    // Dependent expressions
    const func1 = () => {
      const val1 = spy(base1)
      return `func1-${val1}`
    }
    const func2 = () => {
      const val2 = spy(base2)
      return `func2-${val2}`
    }
    const func3 = () => {
      const val1 = spy(expr(func1))
      const val2 = spy(expr(func2))
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
    const testPred = (): any => undefined
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
    const func = vi.fn((arg1, arg2, arg3) => `${arg1}-${arg2}-${arg3}`)
    const e = expr(func, 'a', 'b', 'c')

    const result = rdb.getResult(e)
    expect(result).toBe('a-b-c')
    expect(func).toHaveBeenCalledWith('a', 'b', 'c')
  })

  it('caches computed results for function expressions', () => {
    const rdb = new Database()
    let callCount = 0

    const func = (arg: string) => {
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
    const counter = (): any => undefined
    const baseExpr = expr(counter)
    const doubleFunc = () => {
      const count = spy(baseExpr) || 0
      return count * 2
    }
    const doubleExpr = expr(doubleFunc)

    const quadrupleFunc = () => {
      const doubled = spy(doubleExpr)
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

  it('withModified creates new database with modified expression result', () => {
    const rdb = new Database()
    const testPred = (_arg: string): any => undefined
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
    const testPred = (_arg: string): any => undefined
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
    const base = (): any => undefined

    // Set up base expression
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'original')

    // Create dependent expression
    const dependentFunc = () => {
      const baseValue = spy(baseExpr)
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
    const nonexistent = (): any => undefined
    const e = expr(nonexistent)

    // Modify an expression that doesn't have a result (undefined)
    const modifier = (oldVal: any) => oldVal === undefined ? 'default-value' : `modified-${oldVal}`
    const db2 = rdb.withModified(e, modifier)

    expect(db2.getResult(e)).toBe('default-value')
  })

  it('withModifiedGetAffectedRels includes dependent expressions in affected set', () => {
    const rdb = new Database()
    const base = (): any => undefined

    // Set up base expression
    const baseExpr = expr(base)
    const db1 = rdb.with(baseExpr, 'original')

    // Create dependent expression
    const dependentFunc = () => {
      const baseValue = spy(baseExpr)
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
    const counter = (): any => undefined
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
    const base = (): any => undefined
    const baseExpr = expr(base)
    const throwingFunc = vi.fn(() => {
      const value = spy(baseExpr)
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
    const base = (): any => undefined
    const baseExpr = expr(base)
    const dependentFunc = vi.fn(() => `dep-${spy(baseExpr)}`)
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
    const base = (): any => undefined
    const baseExpr = expr(base)
    const innerError = new Error('inner')
    const innerFunc = vi.fn(() => {
      const value = spy(baseExpr)
      if (value === 'bad') {
        throw innerError
      }
      return `inner-${value}`
    })
    const outerFunc = vi.fn(() => {
      try {
        return `outer-${spy(expr(innerFunc))}`
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
    const base = (): any => undefined
    const baseExpr = expr(base)
    const innerError = new Error('inner')
    const innerFunc = vi.fn(() => {
      const value = spy(baseExpr)
      if (value === 'bad') {
        throw innerError
      }
      return `inner-${value}`
    })
    const outerFunc = vi.fn(() => `outer-${spy(expr(innerFunc))}`)

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

  it('spy outside a computation evaluates the predicate directly without caching', () => {
    let callCount = 0
    const func = vi.fn((arg: string) => {
      callCount++
      return `computed-${arg}-${callCount}`
    })
    const e = expr(func, 'test')

    // No active database, so each spy call re-evaluates
    expect(spy(e)).toBe('computed-test-1')
    expect(spy(e)).toBe('computed-test-2')
    expect(func).toHaveBeenCalledTimes(2)
    expect(func).toHaveBeenCalledWith('test')
  })

  it('computations using another database restore the active database afterwards', () => {
    const base = (): any => undefined
    const baseExpr = expr(base)
    const db1 = new Database().with(baseExpr, 'db1-value')
    const db2 = new Database().with(baseExpr, 'db2-value')

    // A predicate on db1 that reads from db2 via a captured closure,
    // then also spies on a db1-local expression afterwards.
    const outerFunc = vi.fn(() => {
      const fromDb2 = db2.getResult(baseExpr)
      const fromDb1 = spy(baseExpr)
      return `${fromDb2}+${fromDb1}`
    })
    const outerExpr = expr(outerFunc)

    expect(db1.getResult(outerExpr)).toBe('db2-value+db1-value')

    // The spy after the nested db2 read must still have tracked a
    // dependency within db1: changing db1's base invalidates outerExpr.
    const db1b = db1.with(baseExpr, 'db1-new')
    expect(db1b.getResult(outerExpr)).toBe('db2-value+db1-new')
    expect(outerFunc).toHaveBeenCalledTimes(2)
  })

  it('restores the active database when a predicate throws', () => {
    const db = new Database()
    const boom = (): any => { throw new Error('boom') }
    const boomExpr = expr(boom)

    expect(() => db.getResult(boomExpr)).toThrow('boom')

    // After the throw, there must be no leaked active database:
    // a bare spy call should evaluate plainly instead of caching in db.
    let plainCalls = 0
    const plainFunc = () => {
      plainCalls++
      return `plain-${plainCalls}`
    }
    const plainExpr = expr(plainFunc)
    expect(spy(plainExpr)).toBe('plain-1')
    expect(spy(plainExpr)).toBe('plain-2')
    expect(plainCalls).toBe(2)
  })
})
