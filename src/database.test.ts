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

  it('atom updates recompute direct and transitive dependents but preserve unrelated cached results', () => {
    fc.assert(fc.property(
      fc.integer(), fc.integer(), fc.integer(), fc.boolean(), fc.boolean(),
      (initialLeft, initialRight, operand, updateLeft, modify) => {
        const leftAtom = new Atom(initialLeft)
        const rightAtom = new Atom(initialRight)
        const left = vi.fn((factor: number) => spy(value, leftAtom) * factor)
        const right = vi.fn((factor: number) => spy(value, rightAtom) * factor)
        const combined = vi.fn(() => spy(left, 2) + spyExpr(expr(right, 3)))
        const db = new Database()

        // Warm the graph: leftAtom -> left -> combined <- right <- rightAtom
        expect(db.eval(combined)).toBe(initialLeft * 2 + initialRight * 3)
        expect(db.eval(left, 2)).toBe(initialLeft * 2)
        expect(db.eval(right, 3)).toBe(initialRight * 3)

        // Check that internal results are being cached and reused
        for (const computation of [left, right, combined]) {
          expect(computation).toHaveBeenCalledTimes(1)
        }

        // Compute expected values from inputs
        const initialValue = updateLeft ? initialLeft : initialRight
        const nextValue = modify ? initialValue + operand : operand
        const expectedLeft = updateLeft ? nextValue : initialLeft
        const expectedRight = updateLeft ? initialRight : nextValue

        // Create a new database
        const atom = updateLeft ? leftAtom : rightAtom
        const nextDb = modify
          ? db.withModified(atom, oldValue => oldValue + operand)
          : db.with(atom, operand)

        // Check that the values in the new Database
        expect(nextDb.eval(combined)).toBe(expectedLeft * 2 + expectedRight * 3)
        expect(nextDb.eval(left, 2)).toBe(expectedLeft * 2)
        expect(nextDb.eval(right, 3)).toBe(expectedRight * 3)

        // Check that the old Database hasn't changed
        expect(db.eval(combined)).toBe(initialLeft * 2 + initialRight * 3)
        expect(db.eval(left, 2)).toBe(initialLeft * 2)
        expect(db.eval(right, 3)).toBe(initialRight * 3)

        // Check that internal results in the new Database are still using the old Database's cache
        expect(left).toHaveBeenCalledTimes(updateLeft ? 2 : 1)
        expect(right).toHaveBeenCalledTimes(updateLeft ? 1 : 2)
        expect(combined).toHaveBeenCalledTimes(2)
      }
    ))
  })

  it('handles function expressions with multiple arguments', () => {
    const rdb = new Database()
    const func = vi.fn((arg1, arg2, arg3) => `${arg1}-${arg2}-${arg3}`)
    const e = expr(func, 'a', 'b', 'c')

    const result = rdb.evalExpr(e)
    expect(result).toBe('a-b-c')
    expect(func).toHaveBeenCalledWith('a', 'b', 'c')
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
