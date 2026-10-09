import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { Database, RecursiveExpressionComputationError } from './database'
import { spy, spyExpr } from './spy'
import { expr } from './expression'
import { Atom, value } from './atom'

describe('ReactiveDatabase', () => {
  it('eval accepts a function with no arguments', () => {
    const db = new Database()

    expect(db.eval(() => 'result')).toBe('result')
  })

  it('eval delegates to evalExpr and shares its cache', () => {
    const db = new Database()
    const func = vi.fn((label: string, count: number) => `${label}-${count}`)
    const evalExpr = vi.spyOn(db, 'evalExpr')

    const result: string = db.eval(func, 'test', 2)
    expect(result).toBe('test-2')
    expect(evalExpr).toHaveBeenCalledWith(expr(func, 'test', 2))
    expect(db.evalExpr(expr(func, 'test', 2))).toBe(result)
    expect(db.eval(func, 'test', 2)).toBe(result)
    expect(func).toHaveBeenCalledExactlyOnceWith('test', 2)
  })

  it('eval tracks dependencies and recomputes in a derived database', () => {
    const base = new Atom(1)
    const db = new Database()
    const func = vi.fn((factor: number) => spy(value, base) * factor)

    expect(db.eval(func, 3)).toBe(3)
    const db2 = db.with(base, 2)
    expect(db2.eval(func, 3)).toBe(6)
    expect(db.eval(func, 3)).toBe(3)
    expect(func).toHaveBeenCalledTimes(2)
  })

  it('eval propagates and caches errors', () => {
    const db = new Database()
    const error = new Error('boom')
    const func = vi.fn(() => { throw error })

    expect(() => db.eval(func)).toThrow(error)
    expect(() => db.eval(func)).toThrow(error)
    expect(func).toHaveBeenCalledTimes(1)
  })

  it('computes result for function predicates', () => {
    const rdb = new Database()
    const func = vi.fn((arg) => `computed-${arg}`)
    const e = expr(func, 'test-arg')

    const result = rdb.evalExpr(e)
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
      rdb.evalExpr(recursiveExpr)
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(RecursiveExpressionComputationError)
    expect((thrown as RecursiveExpressionComputationError).recursiveExpr.equals(recursiveExpr)).toBe(true)
    expect(recursiveCallCount).toBe(1)
  })

  it("atom update sequences produce correct results but don't modify earlier Databases", () => {
    const text = fc.string()
    const atomValue = fc.option(text, { nil: undefined })
    const update = fc.oneof(
      fc.record({ kind: fc.constant('set' as const), value: atomValue }),
      fc.record({ kind: fc.constant('modify' as const), suffix: text })
    )

    fc.assert(
      fc.property(atomValue, fc.array(update), (defaultValue, updates) => {
        const atom = new Atom<string | undefined>(defaultValue)
        let db = new Database()
        let expectedValue = defaultValue
        const snapshots: [Database, string | undefined][] = [[db, expectedValue]]

        expect(db.eval(value, atom)).toBe(expectedValue)

        // Apply a sequence of updates and check the value in all Databases after each update
        for (const operation of updates) {
          // Calculate the next model value independently of the database APIs.
          const nextExpectedValue = operation.kind === 'set'
            ? operation.value
            : (expectedValue ?? '') + operation.suffix

          const nextDb = operation.kind === 'set'
            ? db.with(atom, operation.value)
            : db.withModified(atom, oldValue => (oldValue ?? '') + operation.suffix)

          expect(nextDb).toBeInstanceOf(Database)
          expect(nextDb).not.toBe(db)

          db = nextDb
          expectedValue = nextExpectedValue
          snapshots.push([db, expectedValue])

          // Check the new value and all saved snapshots
          for (const [snapshot, expected] of snapshots) {
            expect(snapshot.eval(value, atom)).toBe(expected)
          }
        }
      })
    )
  })

  it('returns affected expressions with withGetAffectedRels()', () => {
    const rdb = new Database()
    const atom = new Atom<string | undefined>(undefined)
    const e = expr(value, atom)
    const result = 'test-result'

    const [newDb, affectedExprs] = rdb.withGetAffectedRels(atom, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(affectedExprs.has(e)).toBe(true)
    expect(newDb.evalExpr(e)).toBe(result)
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

    const result = db1.eval(dependentFunc)
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

    // Compute dependent result
    const result1 = db1.eval(dependentFunc)
    expect(result1).toBe('dependent-value1')

    // Update base atom
    const db2 = db1.with(base, 'value2')

    // Dependent should be recomputed with new base value
    const result2 = db2.eval(dependentFunc)
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

    // Test initial computation
    expect(db.eval(func1)).toBe('func1-value1')
    expect(db.eval(func2)).toBe('func2-value2')
    expect(db.eval(func3)).toBe('func3-func1-value1-func2-value2')

    // Update base1 and check propagation
    db = db.with(atom1, 'new-value1')
    expect(db.eval(func1)).toBe('func1-new-value1')
    expect(db.eval(func2)).toBe('func2-value2') // Should be unchanged
    expect(db.eval(func3)).toBe('func3-func1-new-value1-func2-value2')
  })

  it('handles function expressions with multiple arguments', () => {
    const rdb = new Database()
    const func = vi.fn((arg1, arg2, arg3) => `${arg1}-${arg2}-${arg3}`)
    const e = expr(func, 'a', 'b', 'c')

    const result = rdb.evalExpr(e)
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
    const result1 = rdb.evalExpr(e)
    expect(result1).toBe('computed-test-1')
    expect(callCount).toBe(1)

    // Second call should use cache
    const result2 = rdb.evalExpr(e)
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

    // Initial state
    let db = rdb.with(counter, 5)
    expect(db.evalExpr(doubleExpr)).toBe(10)
    expect(db.eval(quadrupleFunc)).toBe(20)

    // Update base value
    db = db.with(counter, 10)
    expect(db.evalExpr(doubleExpr)).toBe(20)
    expect(db.eval(quadrupleFunc)).toBe(40)
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
    expect(db2.evalExpr(e)).toBe('modified-initial-value')
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

    // Compute dependent result
    const result1 = db1.eval(dependentFunc)
    expect(result1).toBe('dependent-original')

    // Modify base atom using withModified
    const modifier = (oldVal: string | undefined) => `${oldVal}-modified`
    const db2 = db1.withModified(base, modifier)

    // Dependent should be recomputed with new base value
    const result2 = db2.eval(dependentFunc)
    expect(result2).toBe('dependent-original-modified')
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
    db1.evalExpr(dependentExpr)

    // Modify base atom value and get affected expressions
    const modifier = (oldVal: string | undefined) => `${oldVal}-modified`
    const [db2, affectedExprs] = db1.withModifiedGetAffectedRels(base, modifier)

    // Both base and dependent expressions should be affected
    expect(affectedExprs.has(baseExpr)).toBe(true)
    expect(affectedExprs.has(dependentExpr)).toBe(true)
  })

  it('caches and rethrows the same error instance', () => {
    const db = new Database()
    const throwingFunc = vi.fn(() => {
      throw new Error('boom')
    })

    const e = expr(throwingFunc)

    let firstError
    try {
      db.evalExpr(e)
    } catch (err) {
      firstError = err
    }

    let secondError
    try {
      db.evalExpr(e)
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

    const db2 = db.with(base, 'bad')

    let firstError
    try {
      db2.eval(throwingFunc)
    } catch (err) {
      firstError = err
    }

    let secondError
    try {
      db2.eval(throwingFunc)
    } catch (err) {
      secondError = err
    }

    expect(firstError).toBeInstanceOf(Error)
    expect(secondError).toBe(firstError)
    expect(throwingFunc).toHaveBeenCalledTimes(1)

    const db3 = db2.with(base, 'good')
    expect(db3.eval(throwingFunc)).toBe('ok-good')
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
    expect(db2.eval(outerFunc)).toBe('outer-inner-good')

    const db3 = db2.with(base, 'bad')
    expect(db3.eval(outerFunc)).toBe('outer-fallback')
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
      db.eval(outerFunc)
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBe(innerError)

    let cachedError
    try {
      db.eval(outerFunc)
    } catch (err) {
      cachedError = err
    }

    expect(cachedError).toBe(innerError)

    db = db.with(base, 'good')
    expect(db.eval(outerFunc)).toBe('outer-inner-good')
    expect(innerFunc).toHaveBeenCalledTimes(2)
  })

})
