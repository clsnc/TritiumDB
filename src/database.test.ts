import { describe, it, expect, vi } from 'vitest'
import { Database, RecursiveExpressionComputationError } from './database'
import { spy, spyExpr } from './spy'
import { expr } from './expression'
import { Atom, value } from './atom'

describe('ReactiveDatabase', () => {
  it('creates a ReactiveDatabase instance', () => {
    const rdb = new Database()

    expect(rdb).toBeInstanceOf(Database)
  })

  it('computes result for function predicates', () => {
    const rdb = new Database()
    const func = vi.fn((arg) => `computed-${arg}`)
    const e = expr(func, 'test-arg')

    const result = rdb.getExprResult(e)
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
        return spy(recursiveFunc, arg)
      }
      return 'result'
    }

    const recursiveExpr = expr(recursiveFunc, 'test')

    let thrown
    try {
      rdb.getExprResult(recursiveExpr)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RecursiveExpressionComputationError)
    expect((thrown as RecursiveExpressionComputationError).recursiveExpr.equals(recursiveExpr)).toBe(true)
    expect(recursiveCallCount).toBe(1)
  })

  it('creates immutable database with with() method', () => {
    const rdb = new Database()
    const atom = new Atom<string | undefined>(undefined)
    const e = expr(value, atom)
    const result = 'test-result'

    const newDb = rdb.with(atom, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(newDb).not.toBe(rdb) // Should be a new instance
    expect(newDb.getExprResult(e)).toBe(result)
    expect(rdb.getExprResult(e)).toBeUndefined() // Original unchanged
  })

  it('returns affected expressions with withGetAffectedRels()', () => {
    const rdb = new Database()
    const atom = new Atom<string | undefined>(undefined)
    const e = expr(value, atom)
    const result = 'test-result'

    const [newDb, affectedExprs] = rdb.withGetAffectedRels(atom, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(affectedExprs.has(e)).toBe(true)
    expect(newDb.getExprResult(e)).toBe(result)
  })

  it('allows values to depend on other values', () => {
    const rdb = new Database()

    // Create a base atom
    const base = new Atom<string | undefined>(undefined)
    const db1 = rdb.with(base, 'base-value')

    // Create a dependent expression that uses the base
    const dependentFunc = () => {
      const baseValue = spy(value, base)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    const result = db1.getExprResult(dependentExpr)
    expect(result).toBe('dependent-base-value')
  })

  it('invalidates dependent expressions when an atom value changes', () => {
    const rdb = new Database()

    // Set up base atom
    const base = new Atom<string | undefined>(undefined)
    const db1 = rdb.with(base, 'value1')

    // Create dependent expression
    const dependentFunc = () => {
      const baseValue = spy(value, base)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    // Compute dependent result
    const result1 = db1.getExprResult(dependentExpr)
    expect(result1).toBe('dependent-value1')

    // Update base atom
    const db2 = db1.with(base, 'value2')

    // Dependent should be recomputed with new base value
    const result2 = db2.getExprResult(dependentExpr)
    expect(result2).toBe('dependent-value2')
  })

  it('handles complex dependency graphs', () => {
    const rdb = new Database()

    // Base atoms
    const atom1 = new Atom<string | undefined>(undefined)
    const atom2 = new Atom<string | undefined>(undefined)

    // Set base values
    let db = rdb.with(atom1, 'value1').with(atom2, 'value2')

    // Dependent expressions
    const func1 = () => {
      const val1 = spy(value, atom1)
      return `func1-${val1}`
    }
    const func2 = () => {
      const val2 = spy(value, atom2)
      return `func2-${val2}`
    }
    const func3 = () => {
      const val1 = spy(func1)
      const val2 = spy(func2)
      return `func3-${val1}-${val2}`
    }

    const dependent1 = expr(func1)
    const dependent2 = expr(func2)
    const dependent3 = expr(func3)

    // Test initial computation
    expect(db.getExprResult(dependent1)).toBe('func1-value1')
    expect(db.getExprResult(dependent2)).toBe('func2-value2')
    expect(db.getExprResult(dependent3)).toBe('func3-func1-value1-func2-value2')

    // Update base1 and check propagation
    db = db.with(atom1, 'new-value1')
    expect(db.getExprResult(dependent1)).toBe('func1-new-value1')
    expect(db.getExprResult(dependent2)).toBe('func2-value2') // Should be unchanged
    expect(db.getExprResult(dependent3)).toBe('func3-func1-new-value1-func2-value2')
  })

  it('maintains immutability when creating new instances', () => {
    const rdb = new Database()
    const atom = new Atom<string | undefined>(undefined)
    const e = expr(value, atom)

    const db1 = rdb.with(atom, 'value1')
    const db2 = db1.with(atom, 'value2')

    // Each database should have its own state
    expect(rdb.getExprResult(e)).toBeUndefined()
    expect(db1.getExprResult(e)).toBe('value1')
    expect(db2.getExprResult(e)).toBe('value2')

    // Original databases should be unchanged
    expect(db1.getExprResult(e)).toBe('value1')
  })

  it('handles function expressions with multiple arguments', () => {
    const rdb = new Database()
    const func = vi.fn((arg1, arg2, arg3) => `${arg1}-${arg2}-${arg3}`)
    const e = expr(func, 'a', 'b', 'c')

    const result = rdb.getExprResult(e)
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
    const result1 = rdb.getExprResult(e)
    expect(result1).toBe('computed-test-1')
    expect(callCount).toBe(1)

    // Second call should use cache
    const result2 = rdb.getExprResult(e)
    expect(result2).toBe('computed-test-1') // Same result as first call
    expect(callCount).toBe(1) // Function not called again
  })

  it('demonstrates reactive behavior with cascading updates', () => {
    const rdb = new Database()

    // Create a chain of dependent expressions
    const counter = new Atom(0)
    const doubleFunc = () => {
      const count = spy(value, counter) || 0
      return count * 2
    }
    const doubleExpr = expr(doubleFunc)

    const quadrupleFunc = () => {
      const doubled = spyExpr(doubleExpr)
      return doubled * 2
    }
    const quadrupleExpr = expr(quadrupleFunc)

    // Initial state
    let db = rdb.with(counter, 5)
    expect(db.getExprResult(doubleExpr)).toBe(10)
    expect(db.getExprResult(quadrupleExpr)).toBe(20)

    // Update base value
    db = db.with(counter, 10)
    expect(db.getExprResult(doubleExpr)).toBe(20)
    expect(db.getExprResult(quadrupleExpr)).toBe(40)
  })

  it('withModified creates new database with modified atom value', () => {
    const rdb = new Database()
    const atom = new Atom<string | undefined>(undefined)
    const e = expr(value, atom)
    const initialResult = 'initial-value'

    // Set initial value
    const db1 = rdb.with(atom, initialResult)

    // Modify the atom using withModified
    const modifier = (oldVal: string | undefined) => `modified-${oldVal}`
    const db2 = db1.withModified(atom, modifier)

    expect(db2).toBeInstanceOf(Database)
    expect(db2).not.toBe(db1) // Should be a new instance
    expect(db1.getExprResult(e)).toBe(initialResult) // Original unchanged
    expect(db2.getExprResult(e)).toBe('modified-initial-value') // Modified in new db
  })

  it('withModifiedGetAffectedRels returns affected expressions', () => {
    const rdb = new Database()
    const atom = new Atom<string | undefined>(undefined)
    const e = expr(value, atom)
    const initialResult = 'initial-value'

    // Set initial value
    const db1 = rdb.with(atom, initialResult)

    // Modify the atom value using withModifiedGetAffectedRels
    const modifier = (oldVal: string | undefined) => `modified-${oldVal}`
    const [db2, affectedExprs] = db1.withModifiedGetAffectedRels(atom, modifier)

    expect(db2).toBeInstanceOf(Database)
    expect(affectedExprs.has(e)).toBe(true)
    expect(db2.getExprResult(e)).toBe('modified-initial-value')
  })

  it('withModified invalidates dependent expressions', () => {
    const rdb = new Database()
    const base = new Atom<string | undefined>(undefined)

    // Set up base atom
    const db1 = rdb.with(base, 'original')

    // Create dependent expression
    const dependentFunc = () => {
      const baseValue = spy(value, base)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    // Compute dependent result
    const result1 = db1.getExprResult(dependentExpr)
    expect(result1).toBe('dependent-original')

    // Modify base atom using withModified
    const modifier = (oldVal: string | undefined) => `${oldVal}-modified`
    const db2 = db1.withModified(base, modifier)

    // Dependent should be recomputed with new base value
    const result2 = db2.getExprResult(dependentExpr)
    expect(result2).toBe('dependent-original-modified')
  })

  it('withModified handles undefined initial values', () => {
    const rdb = new Database()
    const atom = new Atom<string | undefined>(undefined)
    const e = expr(value, atom)

    // Modify an atom with an undefined default value
    const modifier = (oldVal: string | undefined) => oldVal === undefined ? 'default-value' : `modified-${oldVal}`
    const db2 = rdb.withModified(atom, modifier)

    expect(db2.getExprResult(e)).toBe('default-value')
  })

  it('withModifiedGetAffectedRels includes dependent expressions in affected set', () => {
    const rdb = new Database()
    const base = new Atom<string | undefined>(undefined)

    // Set up base atom and its value expression
    const baseExpr = expr(value, base)
    const db1 = rdb.with(base, 'original')

    // Create dependent expression
    const dependentFunc = () => {
      const baseValue = spyExpr(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = expr(dependentFunc)

    // Compute dependent to establish dependency
    db1.getExprResult(dependentExpr)

    // Modify base atom value and get affected expressions
    const modifier = (oldVal: string | undefined) => `${oldVal}-modified`
    const [db2, affectedExprs] = db1.withModifiedGetAffectedRels(base, modifier)

    // Both base and dependent expressions should be affected
    expect(affectedExprs.has(baseExpr)).toBe(true)
    expect(affectedExprs.has(dependentExpr)).toBe(true)
  })

  it('withModified maintains immutability across multiple modifications', () => {
    const rdb = new Database()
    const counter = new Atom(0)
    const e = expr(value, counter)

    const db1 = rdb.withModified(counter, val => val + 1)
    const db2 = db1.withModified(counter, val => val * 2)
    const db3 = db2.withModified(counter, val => val - 3)

    // Each database should have its own state
    expect(rdb.getExprResult(e)).toBe(0)
    expect(db1.getExprResult(e)).toBe(1)
    expect(db2.getExprResult(e)).toBe(2)
    expect(db3.getExprResult(e)).toBe(-1)

    // Original databases should be unchanged
    expect(db1.getExprResult(e)).toBe(1)
    expect(db2.getExprResult(e)).toBe(2)
  })

  it('caches and rethrows the same error instance', () => {
    const db = new Database()
    const throwingFunc = vi.fn(() => {
      throw new Error('boom')
    })

    const e = expr(throwingFunc)

    let firstError
    try {
      db.getExprResult(e)
    } catch (err) {
      firstError = err
    }

    let secondError
    try {
      db.getExprResult(e)
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
    const base = new Atom<string | undefined>(undefined)
    const throwingFunc = vi.fn(() => {
      const baseValue = spy(value, base)
      if (baseValue === 'bad') {
        throw new Error('bad')
      }
      return `ok-${baseValue}`
    })

    const e = expr(throwingFunc)
    const db2 = db.with(base, 'bad')

    let firstError
    try {
      db2.getExprResult(e)
    } catch (err) {
      firstError = err
    }

    let secondError
    try {
      db2.getExprResult(e)
    } catch (err) {
      secondError = err
    }

    expect(firstError).toBeInstanceOf(Error)
    expect(secondError).toBe(firstError)
    expect(throwingFunc).toHaveBeenCalledTimes(1)

    const db3 = db2.with(base, 'good')
    expect(db3.getExprResult(e)).toBe('ok-good')
    expect(throwingFunc).toHaveBeenCalledTimes(2)
  })

  it('allows dependent predicates to catch errors', () => {
    const db = new Database()
    const base = new Atom<string | undefined>(undefined)
    const innerError = new Error('inner')
    const innerFunc = vi.fn(() => {
      const baseValue = spy(value, base)
      if (baseValue === 'bad') {
        throw innerError
      }
      return `inner-${baseValue}`
    })
    const outerFunc = vi.fn(() => {
      try {
        return `outer-${spy(innerFunc)}`
      } catch (err) {
        return 'outer-fallback'
      }
    })

    const db2 = db.with(base, 'good')
    expect(db2.getExprResult(expr(outerFunc))).toBe('outer-inner-good')

    const db3 = db2.with(base, 'bad')
    expect(db3.getExprResult(expr(outerFunc))).toBe('outer-fallback')
    expect(innerFunc).toHaveBeenCalledTimes(2)
  })

  it('propagates errors through dependent expressions', () => {
    const rdb = new Database()
    const base = new Atom<string | undefined>(undefined)
    const innerError = new Error('inner')
    const innerFunc = vi.fn(() => {
      const baseValue = spy(value, base)
      if (baseValue === 'bad') {
        throw innerError
      }
      return `inner-${baseValue}`
    })
    const outerFunc = vi.fn(() => `outer-${spy(innerFunc)}`)

    let db = rdb.with(base, 'bad')
    let caughtError
    try {
      db.getExprResult(expr(outerFunc))
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBe(innerError)

    let cachedError
    try {
      db.getExprResult(expr(outerFunc))
    } catch (err) {
      cachedError = err
    }

    expect(cachedError).toBe(innerError)

    db = db.with(base, 'good')
    expect(db.getExprResult(expr(outerFunc))).toBe('outer-inner-good')
    expect(innerFunc).toHaveBeenCalledTimes(2)
  })

})
