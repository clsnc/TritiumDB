import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { Database, RecursiveExpressionComputationError } from './database'
import { spy, spyExpr } from './spy'
import { expr } from './expression'
import { Atom, value } from './atom'

describe('ReactiveDatabase', () => {
  describe('batch assignments', () => {
    it('sets heterogeneous readonly assignments without changing the original snapshot', () => {
      const count = new Atom(0)
      const name = new Atom('default')
      const db = new Database().with(count, 1).with(name, 'before')
      const assignments = [[count, 10], [name, 'after']] as const
      const nextDb = db.withMany(...assignments)

      expect(nextDb).not.toBe(db)
      expect(nextDb.eval(value, count)).toBe(10)
      expect(nextDb.eval(value, name)).toBe('after')
      expect(db.eval(value, count)).toBe(1)
      expect(db.eval(value, name)).toBe('before')
    })

    it('unions direct, shared, and transitive invalidations while preserving unrelated caches', () => {
      const a = new Atom(1)
      const b = new Atom(2)
      const other = new Atom(3)
      const left = vi.fn(() => spy(value, a) * 2)
      const right = vi.fn(() => spy(value, b) * 3)
      const shared = vi.fn(() => spy(left) + spy(right))
      const transitive = vi.fn(() => spy(shared) + 1)
      const unrelated = vi.fn(() => spy(value, other))
      const db = new Database()
      expect(db.eval(transitive)).toBe(9)
      expect(db.eval(unrelated)).toBe(3)

      const [nextDb, affected] = db.withManyGetAffectedRels([a, 10], [b, 20])
      const expected = [expr(value, a), expr(value, b), expr(left), expr(right), expr(shared), expr(transitive)]
      expect(affected.size).toBe(expected.length)
      for (const expression of expected) expect(affected.has(expression)).toBe(true)
      // Applying the batch must not run any derived computations.
      for (const computation of [left, right, shared, transitive, unrelated]) {
        expect(computation).toHaveBeenCalledTimes(1)
      }

      expect(nextDb.eval(transitive)).toBe(81)
      expect(nextDb.eval(unrelated)).toBe(3)
      expect(db.eval(transitive)).toBe(9)
      for (const computation of [left, right, shared, transitive]) {
        expect(computation).toHaveBeenCalledTimes(2)
      }
      expect(unrelated).toHaveBeenCalledTimes(1)
    })

    it('uses the last duplicate assignment and retains earlier invalidations', () => {
      const atom = new Atom(0)
      const dependent = () => spy(value, atom) + 1
      const db = new Database()
      db.eval(dependent)

      const [nextDb, affected] = db.withManyGetAffectedRels([atom, 10], [atom, 20])
      expect(nextDb.eval(value, atom)).toBe(20)
      expect(nextDb.eval(dependent)).toBe(21)
      expect(affected.size).toBe(2)
      expect(affected.has(expr(value, atom))).toBe(true)
      expect(affected.has(expr(dependent))).toBe(true)
      expect(db.eval(dependent)).toBe(1)
    })

    it('invalidates dependencies even when assigned values are unchanged', () => {
      const atom = new Atom(1)
      const dependent = vi.fn(() => spy(value, atom) + 1)
      const db = new Database()
      db.eval(dependent)

      const [nextDb, affected] = db.withManyGetAffectedRels([atom, 1])
      expect(nextDb).not.toBe(db)
      expect(affected.size).toBe(2)
      expect(affected.has(expr(dependent))).toBe(true)
      expect(nextDb.eval(dependent)).toBe(2)
      expect(dependent).toHaveBeenCalledTimes(2)
    })

    it('returns the original snapshot and no invalidations for an empty batch', () => {
      const db = new Database()
      const [nextDb, affected] = db.withManyGetAffectedRels()
      expect(nextDb).toBe(db)
      expect(affected.size).toBe(0)
      expect(db.withMany()).toBe(db)
    })
  })

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

  it('atom updates report exactly their established direct and transitive dependents', () => {
    fc.assert(fc.property(
      fc.integer(), fc.integer(), fc.integer(), fc.boolean(), fc.boolean(), fc.boolean(),
      (defaultLeft, defaultRight, operand, updateLeft, modify, warmGraph) => {
        const leftAtom = new Atom(defaultLeft)
        const rightAtom = new Atom(defaultRight)
        const left = () => spyExpr(expr(value, leftAtom)) * 2
        const right = () => spy(value, rightAtom) * 3
        const combined = () => spy(left) + spy(right)
        const db = new Database()

        // Dependencies only exist after the graph has been evaluated
        if (warmGraph) {
          db.eval(combined)
        }

        const atom = updateLeft ? leftAtom : rightAtom
        const initialValue = updateLeft ? defaultLeft : defaultRight
        const expectedValue = modify ? initialValue + operand : operand
        const [nextDb, affectedExprs] = modify
          ? db.withModifiedGetAffectedRels(atom, oldValue => oldValue + operand)
          : db.withGetAffectedRels(atom, operand)

        // Whether the graph is warm determines which invalidations are expected
        const expectedExprs = warmGraph
          ? [expr(value, atom), expr(updateLeft ? left : right), expr(combined)]
          : [expr(value, atom)]

        // Check that all expected expressions have been invalidated
        for (const expression of expectedExprs) {
          expect(affectedExprs.has(expression)).toBe(true)
        }

        // Check that there are no extra invalidated expressions
        expect(affectedExprs.size).toBe(expectedExprs.length)

        expect(nextDb).toBeInstanceOf(Database)
        expect(nextDb.evalExpr(expr(value, atom))).toBe(expectedValue)
      }
    ))
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
