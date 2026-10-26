import { describe, it, expect, vi } from 'vitest'
import { Atom, value } from './atom'
import { Database, RecursiveExpressionComputationError } from './database'
import { expr } from './expression'
import { memoize } from './memoize'
import { spy, spyExpr } from './spy'

describe('memoize', () => {
  it('wraps a function without evaluating it', () => {
    const original = vi.fn(() => 'result')
    const wrapped = memoize(original)

    expect(original).not.toHaveBeenCalled()
    expect(wrapped()).toBe('result')
    expect(original).toHaveBeenCalledExactlyOnceWith()
  })

  it('forwards multiple arguments and preserves the returned value', () => {
    const result = { label: 'result' }
    const original = vi.fn((_name: string, _count: number) => result)
    const wrapped = memoize(original)

    expect(wrapped('item', 2)).toBe(result)
    expect(original).toHaveBeenCalledExactlyOnceWith('item', 2)
  })

  it('does not cache outside a database, even after a database evaluation', () => {
    let calls = 0
    const original = vi.fn(() => ++calls)
    const wrapped = memoize(original)
    const db = new Database()

    expect(wrapped()).toBe(1)
    expect(wrapped()).toBe(2)
    expect(db.eval(wrapped)).toBe(3)
    expect(db.eval(wrapped)).toBe(3)
    expect(wrapped()).toBe(4)
    expect(original).toHaveBeenCalledTimes(4)
  })

  it('caches nested calls by their arguments', () => {
    const original = vi.fn((n: number) => n * 2)
    const wrapped = memoize(original)
    const db = new Database()

    expect(db.eval(() => [wrapped(2), wrapped(2), wrapped(3)]))
      .toEqual([4, 4, 6])
    // A different root computation still uses the same cached nested result.
    expect(db.eval(() => wrapped(2))).toBe(4)
    expect(original).toHaveBeenCalledTimes(2)
    expect(original).toHaveBeenNthCalledWith(1, 2)
    expect(original).toHaveBeenNthCalledWith(2, 3)
  })

  it('keeps different original functions separate', () => {
    const first = vi.fn((n: number) => n * 2)
    const second = vi.fn((n: number) => n * 3)
    const wrappedFirst = memoize(first)
    const wrappedSecond = memoize(second)
    const db = new Database()

    expect(db.eval(() => [wrappedFirst(2), wrappedSecond(2), wrappedFirst(2)]))
      .toEqual([4, 6, 4])
    expect(first).toHaveBeenCalledExactlyOnceWith(2)
    expect(second).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('shares the original function cache with spy, spyExpr, and other wrappers', () => {
    const original = vi.fn((n: number) => n * 2)
    const wrapped = memoize(original)
    const anotherWrapper = memoize(original)
    const db = new Database()

    expect(db.eval(() => [
      wrapped(2),
      spy(original, 2),
      spyExpr(expr(original, 2)),
      anotherWrapper(2),
    ])).toEqual([4, 4, 4, 4])
    expect(db.eval(original, 2)).toBe(4)
    expect(original).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('works as a direct eval and evalExpr target without false recursion', () => {
    const original = vi.fn((n: number) => n * 2)
    const wrapped = memoize(original)
    const db = new Database()

    expect(db.eval(wrapped, 2)).toBe(4)
    expect(db.evalExpr(expr(wrapped, 2))).toBe(4)
    expect(db.eval(() => wrapped(2))).toBe(4)
    expect(original).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('keeps caches scoped to each database', () => {
    const original = vi.fn(() => ({}))
    const wrapped = memoize(original)
    const firstDb = new Database()
    const secondDb = new Database()
    const firstResult = firstDb.eval(wrapped)
    const secondResult = secondDb.eval(wrapped)

    expect(firstResult).not.toBe(secondResult)
    expect(firstDb.eval(wrapped)).toBe(firstResult)
    expect(secondDb.eval(wrapped)).toBe(secondResult)
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('tracks transitive dependencies while preserving earlier snapshots', () => {
    const count = new Atom(1)
    const original = vi.fn((factor: number) => spy(value, count) * factor)
    const wrapped = memoize(original)
    const outerOriginal = vi.fn(() => wrapped(2) + 1)
    const outer = memoize(outerOriginal)
    const db = new Database()

    expect(db.eval(outer)).toBe(3)
    const nextDb = db.with(count, 4)
    expect(nextDb.eval(outer)).toBe(9)
    expect(nextDb.eval(() => wrapped(2))).toBe(8)
    expect(db.eval(outer)).toBe(3)
    expect(original).toHaveBeenCalledTimes(2)
    expect(outerOriginal).toHaveBeenCalledTimes(2)
  })

  it('caches nested errors and invalidates them when dependencies change', () => {
    const shouldThrow = new Atom(true)
    const error = new Error('boom')
    const original = vi.fn(() => {
      if (spy(value, shouldThrow)) throw error
      return 'recovered'
    })
    const wrapped = memoize(original)
    const db = new Database()

    // Catch in the root so repeated calls exercise the nested error cache.
    db.eval(() => {
      expect(wrapped).toThrow(error)
      expect(wrapped).toThrow(error)
    })
    expect(original).toHaveBeenCalledTimes(1)

    const nextDb = db.with(shouldThrow, false)
    expect(nextDb.eval(wrapped)).toBe('recovered')
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('does not cache errors outside a database', () => {
    const original = vi.fn(() => { throw new Error('boom') })
    const wrapped = memoize(original)

    expect(wrapped).toThrow('boom')
    expect(wrapped).toThrow('boom')
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('detects genuine recursion for the original function and arguments', () => {
    const original = (n: number): number => wrapped(n)
    const wrapped = memoize(original)
    const db = new Database()

    let thrown: unknown
    try {
      db.eval(wrapped, 1)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RecursiveExpressionComputationError)
    expect((thrown as RecursiveExpressionComputationError).recursiveExpr.equals(expr(original, 1)))
      .toBe(true)
  })

  it('allows recursive calls with different arguments', () => {
    const original = vi.fn((n: number): number => n === 0 ? 1 : n * factorial(n - 1))
    const factorial = memoize(original)
    const db = new Database()

    expect(db.eval(factorial, 4)).toBe(24)
    expect(db.eval(factorial, 3)).toBe(6)
    expect(original).toHaveBeenCalledTimes(5)
  })
})
