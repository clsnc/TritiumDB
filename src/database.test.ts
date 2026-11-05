// @aiUnreviewed

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { Map as ImmMap } from 'immutable'
import { activeDatabase, Database, emptyDatabase, RecursiveExpressionComputationError } from './database'
import { memoize } from './memoize'
import { expr, type Expression } from './expression'
import { atom as createAtom, value, type Atom } from './atom'

describe('ReactiveDatabase', () => {
  describe('getAtomValue', () => {
    it('returns the default before and after an evaluation', () => {
      const atom = createAtom('default')
      const db = emptyDatabase

      expect(db.getAtomValue(atom)).toBe('default')
      db.eval(value, atom)
      expect(db.getAtomValue(atom)).toBe('default')
    })

    it('returns assignments without changing earlier snapshots or other atoms', () => {
      const atom = createAtom('default')
      const other = createAtom('default')
      const db = emptyDatabase
      const nextDb = db.with(atom, 'assigned')

      expect(nextDb.getAtomValue(atom)).toBe('assigned')
      expect(nextDb.getAtomValue(other)).toBe('default')
      expect(db.getAtomValue(atom)).toBe('default')
    })

    it('returns an explicit undefined assignment instead of the default', () => {
      const atom = createAtom<string | undefined>('default')
      const db = emptyDatabase.with(atom, undefined)

      expect(db.getAtomValue(atom)).toBeUndefined()
    })

    it('returns Error objects assigned as values', () => {
      const atom = createAtom<Error | null>(null)
      const error = new Error('value')
      const db = emptyDatabase.with(atom, error)

      expect(db.getAtomValue(atom)).toBe(error)
    })

    it('does not treat expression-cache entries as atom assignments', () => {
      const atom = createAtom(0)
      const error = new Error('cached exception')
      const db = new Database(ImmMap(), ImmMap([
        [expr(value, atom), { value: error, isReturnValue: false }],
      ]), ImmMap(), ImmMap())

      expect(db.getAtomValue(atom)).toBe(0)
    })
  })

  describe('spyAtomValue', () => {
    it('reads defaults and assignments outside a computation', () => {
      const atom = createAtom<string | undefined>('default')
      const db = emptyDatabase

      expect(db.spyAtomValue(atom)).toBe('default')
      expect(db.with(atom, 'assigned').spyAtomValue(atom)).toBe('assigned')
      expect(db.with(atom, undefined).spyAtomValue(atom)).toBeUndefined()
      expect(db.spyAtomValue(atom)).toBe('default')
    })

    it('tracks reads so dependent results are invalidated across snapshots', () => {
      const atom = createAtom(1)
      const db = emptyDatabase
      const read = vi.fn(() => activeDatabase!.spyAtomValue(atom) * 2)

      expect(db.eval(read)).toBe(2)
      const [nextDb, affected] = db.withGetAffectedRels(atom, 10)

      expect(affected.size).toBe(2)
      expect(affected.has(expr(value, atom))).toBe(true)
      expect(affected.has(expr(read))).toBe(true)
      expect(nextDb.eval(read)).toBe(20)
      expect(db.eval(read)).toBe(2)
      expect(read).toHaveBeenCalledTimes(3)
    })

    it('tracks a dependency before a read throws', () => {
      const atom = createAtom(0)
      const error = new Error('read failed')
      const db = emptyDatabase.with(atom, 0)
      vi.spyOn(db, 'getAtomValue').mockImplementation(() => { throw error })
      const read = vi.fn(() => activeDatabase!.spyAtomValue(atom))

      expect(() => db.eval(read)).toThrow(error)
      expect(() => db.eval(read)).toThrow(error)
      expect(read).toHaveBeenCalledTimes(2)

      const nextDb = db.with(atom, 42)
      expect(nextDb.eval(read)).toBe(42)
      expect(() => db.eval(read)).toThrow(error)
      expect(read).toHaveBeenCalledTimes(4)
    })
  })

  describe('addDependencyToComputingExpression', () => {
    class TestDatabase extends Database {
      constructor() {
        super(ImmMap(), ImmMap(), ImmMap(), ImmMap())
      }

      override addDependencyToComputingExpression(expression: Expression): void {
        super.addDependencyToComputingExpression(expression)
      }
    }

    it('does nothing outside a computation and does not evaluate the expression', () => {
      const db = new TestDatabase()
      const contributor = vi.fn(() => { throw new Error('must not run') })

      expect(db.addDependencyToComputingExpression(expr(contributor))).toBeUndefined()
      expect(contributor).not.toHaveBeenCalled()
    })

    it('does not evaluate the dependency during a computation', () => {
      const db = new TestDatabase()
      const contributor = vi.fn(() => { throw new Error('must not run') })

      db.eval(() => db.addDependencyToComputingExpression(expr(contributor)))

      expect(contributor).not.toHaveBeenCalled()
    })

    it('records dependencies for invalidation without resolving them', () => {
      const db = new TestDatabase()
      const atom = createAtom(1)
      const atomExpr = expr(value, atom)
      const dependent = vi.fn(() => {
        db.addDependencyToComputingExpression(atomExpr)
        return db.getAtomValue(atom) + 1
      })

      expect(db.eval(dependent)).toBe(2)
      const [, affected] = db.withGetAffectedRels(atom, 10)

      expect(affected.size).toBe(2)
      expect(affected.has(atomExpr)).toBe(true)
      expect(affected.has(expr(dependent))).toBe(true)
      expect(dependent).toHaveBeenCalledTimes(1)
    })
  })

  describe('atom storage', () => {
    class TestDatabase extends Database {
      constructor() {
        super(ImmMap(), ImmMap(), ImmMap(), ImmMap())
      }

      override setAtomValueGetAffectedExprs<T>(atom: Atom<T>, nextValue: T) {
        return super.setAtomValueGetAffectedExprs(atom, nextValue)
      }

      clearComputationCache(): void {
        this.exprToCachedResult = this.exprToCachedResult.clear()
      }

      get computationCacheSize(): number {
        return this.exprToCachedResult.size
      }
    }

    it('stores assignments without populating the computation cache', () => {
      const atom = createAtom(0)
      const optional = createAtom<string | undefined>('default')
      const db = new TestDatabase()

      db.setAtomValueGetAffectedExprs(atom, 42)
      db.setAtomValueGetAffectedExprs(optional, undefined)

      expect(db.getAtomValue(atom)).toBe(42)
      expect(db.getAtomValue(optional)).toBeUndefined()
      expect(db.computationCacheSize).toBe(0)
    })

    it('evaluates ordinary results and errors without populating the computation cache', () => {
      const db = new TestDatabase()
      const atom = createAtom(3)
      const read = vi.fn(() => ({ count: value(atom) }))
      const first = db.eval(read)
      const second = db.evalExpr(expr(read))

      expect(first).toEqual({ count: 3 })
      expect(second).toEqual(first)
      expect(second).not.toBe(first)
      expect(read).toHaveBeenCalledTimes(2)

      const throwing = vi.fn(() => { throw new Error('boom') })
      expect(() => db.eval(throwing)).toThrow('boom')
      expect(() => db.evalExpr(expr(throwing))).toThrow('boom')
      expect(throwing).toHaveBeenCalledTimes(2)
      expect(db.computationCacheSize).toBe(0)
    })

    it('preserves assignments when memoized computation results are discarded', () => {
      const atom = createAtom(0)
      const optional = createAtom<string | undefined>('default')
      const db = new TestDatabase()
      db.setAtomValueGetAffectedExprs(atom, 42)
      db.setAtomValueGetAffectedExprs(optional, undefined)
      const read = vi.fn(() => value(atom))

      expect(db.eval(value, atom)).toBe(42)
      expect(db.eval(value, optional)).toBeUndefined()
      expect(db.eval(memoize(read))).toBe(42)
      expect(db.computationCacheSize).toBeGreaterThan(0)

      db.clearComputationCache()

      expect(db.computationCacheSize).toBe(0)
      expect(db.getAtomValue(atom)).toBe(42)
      expect(db.getAtomValue(optional)).toBeUndefined()
      expect(db.eval(value, atom)).toBe(42)
      expect(db.eval(value, optional)).toBeUndefined()
      expect(db.eval(memoize(read))).toBe(42)
      expect(read).toHaveBeenCalledTimes(2)
    })
  })

  describe('computeTrackedExpressionResult', () => {
    class TestDatabase extends Database {
      constructor() {
        super(ImmMap(), ImmMap(), ImmMap(), ImmMap())
      }

      override computeTrackedExpressionResult<A extends any[], R>(expression: Expression<A, R>) {
        return super.computeTrackedExpressionResult(expression)
      }

      get computationCacheSize(): number {
        return this.exprToCachedResult.size
      }
    }

    it('executes and tracks dependencies without populating the result cache', () => {
      const db = new TestDatabase()
      const atom = createAtom(3)
      const read = vi.fn((factor: number) => db.spyAtomValue(atom) * factor)
      const expression = expr(read, 2)

      expect(db.computeTrackedExpressionResult(expression)).toEqual({ value: 6, isReturnValue: true })
      expect(db.computeTrackedExpressionResult(expression)).toEqual({ value: 6, isReturnValue: true })
      expect(read).toHaveBeenCalledTimes(2)
      expect(db.computationCacheSize).toBe(0)

      const [, affected] = db.withGetAffectedRels(atom, 4)
      expect(affected.size).toBe(2)
      expect(affected.has(expression)).toBe(true)
    })

    it('neither reads nor replaces an existing cached result', () => {
      const db = new TestDatabase()
      const read = vi.fn().mockReturnValueOnce('cached').mockReturnValueOnce('fresh')

      expect(db.eval(memoize(read))).toBe('cached')
      expect(db.computeTrackedExpressionResult(expr(read))).toEqual({ value: 'fresh', isReturnValue: true })
      expect(db.eval(memoize(read))).toBe('cached')
      expect(read).toHaveBeenCalledTimes(2)
      expect(db.computationCacheSize).toBe(1)
    })

    it('captures errors without caching them and restores the surrounding tracking context', () => {
      const db = new TestDatabase()
      const innerAtom = createAtom(1)
      const outerAtom = createAtom(2)
      const unrelated = createAtom(0)
      const error = new Error('boom')
      const inner = vi.fn(() => {
        value(innerAtom)
        throw error
      })
      const outer = () => {
        for (let i = 0; i < 2; i++) {
          expect(db.computeTrackedExpressionResult(expr(inner))).toEqual({ value: error, isReturnValue: false })
        }
        return value(outerAtom)
      }

      expect(db.eval(outer)).toBe(2)
      expect(inner).toHaveBeenCalledTimes(2)
      expect(db.computationCacheSize).toBe(0)
      expect(activeDatabase).toBeNull()

      const [, innerAffected] = db.withGetAffectedRels(innerAtom, 10)
      expect(innerAffected.has(expr(inner))).toBe(true)
      const [, outerAffected] = db.withGetAffectedRels(outerAtom, 20)
      expect(outerAffected.has(expr(outer))).toBe(true)
      expect(outerAffected.has(expr(inner))).toBe(false)

      db.spyAtomValue(unrelated)
      const [, unrelatedAffected] = db.withGetAffectedRels(unrelated, 1)
      expect(unrelatedAffected.size).toBe(1)
    })

    it('throws on recursive entry instead of capturing it as a predicate outcome', () => {
      const db = new TestDatabase()
      const read = () => {
        expect(() => db.computeTrackedExpressionResult(expression)).toThrow(RecursiveExpressionComputationError)
        return 42
      }
      const expression = expr(read)

      expect(db.computeTrackedExpressionResult(expression)).toEqual({ value: 42, isReturnValue: true })
      expect(db.computeTrackedExpressionResult(expression)).toEqual({ value: 42, isReturnValue: true })
      expect(db.computationCacheSize).toBe(0)
    })
  })

  describe('batch assignments', () => {
    it('sets heterogeneous readonly assignments without changing the original snapshot', () => {
      const count = createAtom(0)
      const name = createAtom('default')
      const db = emptyDatabase.with(count, 1).with(name, 'before')
      const assignments = [[count, 10], [name, 'after']] as const
      const nextDb = db.withMany(...assignments)

      expect(nextDb).not.toBe(db)
      expect(nextDb.eval(value, count)).toBe(10)
      expect(nextDb.eval(value, name)).toBe('after')
      expect(db.eval(value, count)).toBe(1)
      expect(db.eval(value, name)).toBe('before')
    })

    it('unions direct, shared, and transitive invalidations while preserving unrelated caches', () => {
      const a = createAtom(1)
      const b = createAtom(2)
      const other = createAtom(3)
      const left = vi.fn(() => value(a) * 2)
      const right = vi.fn(() => value(b) * 3)
      const memoizedLeft = memoize(left)
      const memoizedRight = memoize(right)
      const shared = vi.fn(() => memoizedLeft() + memoizedRight())
      const memoizedShared = memoize(shared)
      const transitive = vi.fn(() => memoizedShared() + 1)
      const unrelated = vi.fn(() => value(other))
      const db = emptyDatabase
      expect(db.eval(transitive)).toBe(9)
      expect(db.eval(memoize(unrelated))).toBe(3)

      const [nextDb, affected] = db.withManyGetAffectedRels([a, 10], [b, 20])
      const expected = [expr(value, a), expr(value, b), expr(left), expr(right), expr(shared), expr(transitive)]
      expect(affected.size).toBe(expected.length)
      for (const expression of expected) expect(affected.has(expression)).toBe(true)
      // Applying the batch must not run any derived computations.
      for (const computation of [left, right, shared, transitive, unrelated]) {
        expect(computation).toHaveBeenCalledTimes(1)
      }

      expect(nextDb.eval(transitive)).toBe(81)
      expect(nextDb.eval(memoize(unrelated))).toBe(3)
      expect(db.eval(transitive)).toBe(9)
      for (const computation of [left, right, shared]) {
        expect(computation).toHaveBeenCalledTimes(2)
      }
      expect(transitive).toHaveBeenCalledTimes(3)
      expect(unrelated).toHaveBeenCalledTimes(1)
    })

    it('uses the last duplicate assignment and retains earlier invalidations', () => {
      const atom = createAtom(0)
      const dependent = () => value(atom) + 1
      const db = emptyDatabase
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
      const atom = createAtom(1)
      const dependent = vi.fn(() => value(atom) + 1)
      const db = emptyDatabase
      db.eval(dependent)

      const [nextDb, affected] = db.withManyGetAffectedRels([atom, 1])
      expect(nextDb).not.toBe(db)
      expect(affected.size).toBe(2)
      expect(affected.has(expr(dependent))).toBe(true)
      expect(nextDb.eval(dependent)).toBe(2)
      expect(dependent).toHaveBeenCalledTimes(2)
    })

    it('returns the original snapshot and no invalidations for an empty batch', () => {
      const db = emptyDatabase
      const [nextDb, affected] = db.withManyGetAffectedRels()
      expect(nextDb).toBe(db)
      expect(affected.size).toBe(0)
      expect(db.withMany()).toBe(db)
    })
  })

  it('eval accepts a function with no arguments', () => {
    const db = emptyDatabase

    expect(db.eval(() => 'result')).toBe('result')
  })

  it('eval delegates to evalExpr and executes on every call', () => {
    const db = emptyDatabase.with(createAtom(0), 0)
    const func = vi.fn((label: string, count: number) => `${label}-${count}`)
    const evalExpr = vi.spyOn(db, 'evalExpr')

    const result: string = db.eval(func, 'test', 2)
    expect(result).toBe('test-2')
    expect(evalExpr).toHaveBeenCalledWith(expr(func, 'test', 2))
    expect(db.evalExpr(expr(func, 'test', 2))).toBe(result)
    expect(db.eval(func, 'test', 2)).toBe(result)
    expect(func).toHaveBeenCalledTimes(3)
    expect(func).toHaveBeenNthCalledWith(1, 'test', 2)
    expect(func).toHaveBeenNthCalledWith(2, 'test', 2)
    expect(func).toHaveBeenNthCalledWith(3, 'test', 2)
  })

  it('eval and evalExpr propagate errors without caching them', () => {
    const db = emptyDatabase
    const error = new Error('boom')
    const func = vi.fn(() => { throw error })

    expect(() => db.eval(func)).toThrow(error)
    expect(() => db.evalExpr(expr(func))).toThrow(error)
    expect(() => db.eval(func)).toThrow(error)
    expect(func).toHaveBeenCalledTimes(3)
  })

  it('computes result for function predicates', () => {
    const rdb = emptyDatabase
    const func = vi.fn((arg) => `computed-${arg}`)
    const e = expr(func, 'test-arg')

    const result = rdb.evalExpr(e)
    expect(result).toBe('computed-test-arg')
    expect(func).toHaveBeenCalledWith('test-arg')
  })

  it('throws RecursiveExpressionComputationError for recursive computation of the same expression', () => {
    const rdb = emptyDatabase
    let recursiveCallCount = 0

    const recursiveFunc = (arg: string): string => {
      recursiveCallCount++
      if (recursiveCallCount === 1) {
        // First call, trigger recursion
        return memoizedRecursiveFunc(arg)
      }
      return 'result'
    }

    const memoizedRecursiveFunc = memoize(recursiveFunc)
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
        const atom = createAtom<string | undefined>(defaultValue)
        let db = emptyDatabase
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
        const leftAtom = createAtom(defaultLeft)
        const rightAtom = createAtom(defaultRight)
        const left = () => value(leftAtom) * 2
        const right = () => value(rightAtom) * 3
        const memoizedLeft = memoize(left)
        const memoizedRight = memoize(right)
        const combined = () => memoizedLeft() + memoizedRight()
        const db = emptyDatabase

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
        const leftAtom = createAtom(initialLeft)
        const rightAtom = createAtom(initialRight)
        const left = vi.fn((factor: number) => value(leftAtom) * factor)
        const right = vi.fn((factor: number) => value(rightAtom) * factor)
        const memoizedLeft = memoize(left)
        const memoizedRight = memoize(right)
        const combined = vi.fn(() => memoizedLeft(2) + memoizedRight(3))
        const memoizedCombined = memoize(combined)
        const db = emptyDatabase

        // Warm the graph: leftAtom -> left -> combined <- right <- rightAtom
        expect(db.eval(memoizedCombined)).toBe(initialLeft * 2 + initialRight * 3)
        expect(db.eval(memoizedLeft, 2)).toBe(initialLeft * 2)
        expect(db.eval(memoizedRight, 3)).toBe(initialRight * 3)

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
        expect(nextDb.eval(memoizedCombined)).toBe(expectedLeft * 2 + expectedRight * 3)
        expect(nextDb.eval(memoizedLeft, 2)).toBe(expectedLeft * 2)
        expect(nextDb.eval(memoizedRight, 3)).toBe(expectedRight * 3)

        // Check that the old Database hasn't changed
        expect(db.eval(memoizedCombined)).toBe(initialLeft * 2 + initialRight * 3)
        expect(db.eval(memoizedLeft, 2)).toBe(initialLeft * 2)
        expect(db.eval(memoizedRight, 3)).toBe(initialRight * 3)

        // Check that internal results in the new Database are still using the old Database's cache
        expect(left).toHaveBeenCalledTimes(updateLeft ? 2 : 1)
        expect(right).toHaveBeenCalledTimes(updateLeft ? 1 : 2)
        expect(combined).toHaveBeenCalledTimes(2)
      }
    ))
  })

  it('handles function expressions with multiple arguments', () => {
    const rdb = emptyDatabase
    const func = vi.fn((arg1, arg2, arg3) => `${arg1}-${arg2}-${arg3}`)
    const e = expr(func, 'a', 'b', 'c')

    const result = rdb.evalExpr(e)
    expect(result).toBe('a-b-c')
    expect(func).toHaveBeenCalledWith('a', 'b', 'c')
  })

  it('memoize caches and rethrows the same error instance', () => {
    const db = emptyDatabase
    const throwingFunc = vi.fn(() => {
      throw new Error('boom')
    })

    const e = expr(memoize(throwingFunc))

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

    expect(firstError).toBeInstanceOf(Error)
    expect((firstError as Error).message).toEqual('boom')
    expect(secondError).toBe(firstError)
    expect(throwingFunc).toHaveBeenCalledTimes(1)
  })

  it('invalidates memoized errors when dependencies change', () => {
    const db = emptyDatabase
    const base = createAtom<string | undefined>(undefined)
    const throwingFunc = vi.fn(() => {
      const baseValue = value(base)
      if (baseValue === 'bad') {
        throw new Error('bad')
      }
      return `ok-${baseValue}`
    })

    const db2 = db.with(base, 'bad')

    let firstError
    try {
      db2.eval(memoize(throwingFunc))
    } catch (err) {
      firstError = err
    }

    let secondError
    try {
      db2.eval(memoize(throwingFunc))
    } catch (err) {
      secondError = err
    }

    expect(firstError).toBeInstanceOf(Error)
    expect(secondError).toBe(firstError)
    expect(throwingFunc).toHaveBeenCalledTimes(1)

    const db3 = db2.with(base, 'good')
    expect(db3.eval(memoize(throwingFunc))).toBe('ok-good')
    expect(throwingFunc).toHaveBeenCalledTimes(2)
  })

  it('allows dependent predicates to catch errors', () => {
    const db = emptyDatabase
    const base = createAtom<string | undefined>(undefined)
    const innerError = new Error('inner')
    const innerFunc = vi.fn(() => {
      const baseValue = value(base)
      if (baseValue === 'bad') {
        throw innerError
      }
      return `inner-${baseValue}`
    })
    const memoizedInnerFunc = memoize(innerFunc)
    const outerFunc = vi.fn(() => {
      try {
        return `outer-${memoizedInnerFunc()}`
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
    const rdb = emptyDatabase
    const base = createAtom<string | undefined>(undefined)
    const innerError = new Error('inner')
    const innerFunc = vi.fn(() => {
      const baseValue = value(base)
      if (baseValue === 'bad') {
        throw innerError
      }
      return `inner-${baseValue}`
    })
    const memoizedInnerFunc = memoize(innerFunc)
    const outerFunc = vi.fn(() => `outer-${memoizedInnerFunc()}`)

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
