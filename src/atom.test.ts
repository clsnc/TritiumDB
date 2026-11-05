// @aiUnreviewed

import { describe, it, expect, vi } from 'vitest'
import { atom as createAtom, emptyDatabase, expr, memoize, Reactor, value } from './index'

describe('Atom', () => {
  describe('defaults and identity', () => {
    it('stores the supplied default value without copying it', () => {
      const defaultValue = { count: 0 }
      const count = createAtom(defaultValue)

      expect(count.defaultValue).toBe(defaultValue)
      expect(count()).toBe(defaultValue)
    })

    it('creates independent atoms even when they share a default object', () => {
      const defaultValue = { count: 0 }
      const first = createAtom(defaultValue)
      const second = createAtom(defaultValue)
      const assigned = { count: 1 }
      const db = emptyDatabase.with(first, assigned)

      expect(first).not.toBe(second)
      expect(db.eval(first)).toBe(assigned)
      expect(db.eval(second)).toBe(defaultValue)
    })

    it('preserves object and function defaults without copying or invoking them', () => {
      const defaultValue = { count: 0 }
      const object = createAtom(defaultValue)
      const fn = vi.fn(() => 42)
      const callable = createAtom(fn)

      expect(object()).toBe(defaultValue)
      expect(emptyDatabase.eval(object)).toBe(defaultValue)
      expect(callable()).toBe(fn)
      expect(emptyDatabase.eval(callable)).toBe(fn)
      expect(fn).not.toHaveBeenCalled()
    })

    it('uses reference identity: atoms with equal defaults are independent', () => {
      const db = emptyDatabase
      const v1 = createAtom('same')
      const v2 = createAtom('same')

      expect(expr(v1).equals(expr(v1))).toBe(true)
      expect(expr(v1).equals(expr(v2))).toBe(false)

      const db2 = db.with(v1, 'overridden')
      expect(db2.eval(v1)).toBe('overridden')
      expect(db2.eval(v2)).toBe('same')
    })
  })

  describe('reads and snapshots', () => {
    it('supports undefined defaults and assignments', () => {
      const count = createAtom<number | undefined>(undefined)

      expect(count()).toBeUndefined()
      const db = emptyDatabase.with(count, 1)
      expect(db.eval(count)).toBe(1)
      expect(db.with(count, undefined).eval(count)).toBeUndefined()
    })

    it('returns explicit undefined assignments through direct and evaluated calls instead of the default', () => {
      const name = createAtom<string | undefined>('default')
      const db = emptyDatabase.with(name, undefined)

      expect(db.eval(name)).toBeUndefined()
      expect(db.eval(() => name())).toBeUndefined()
      expect(name()).toBe('default')
      expect(createAtom(undefined)()).toBeUndefined()
    })

    it('returns the default outside evaluation, including after an overridden read', () => {
      const atom = createAtom('default')
      const db = emptyDatabase.with(atom, 'assigned')

      expect(atom()).toBe('default')
      expect(db.eval(() => atom())).toBe('assigned')
      expect(atom()).toBe('default')
    })

    it('returns explicit undefined assignments instead of the default', () => {
      const atom = createAtom<string | undefined>('default')
      const db = emptyDatabase.with(atom, undefined)

      expect(db.eval(() => atom())).toBeUndefined()
      expect(atom()).toBe('default')
    })

    it('returns the default value when no override is set', () => {
      const db = emptyDatabase
      const v = createAtom('anonymous')

      expect(db.eval(v)).toBe('anonymous')
    })

    it('returns the default value outside a computation', () => {
      const v = createAtom('anonymous')

      expect(v()).toBe('anonymous')
    })

    it('returns the overridden value in the derived database only', () => {
      const db = emptyDatabase
      const v = createAtom('anonymous')

      const db2 = db.with(v, 'colson')

      expect(db2.eval(v)).toBe('colson')
      expect(db.eval(v)).toBe('anonymous')
    })
  })

  describe('dependency tracking', () => {
    it('reads and tracks atoms through nested ordinary helpers', () => {
      const atom = createAtom(1)
      const multiply = (factor: number) => atom() * factor
      const triple = vi.fn(() => multiply(3))
      const db = emptyDatabase.with(atom, 2)

      expect(db.eval(triple)).toBe(6)
      expect(db.eval(triple)).toBe(6)
      expect(triple).toHaveBeenCalledTimes(2)

      const [nextDb, affected] = db.withGetAffectedRels(atom, 4)
      expect(affected.size).toBe(2)
      expect(affected.has(expr(value, atom))).toBe(true)
      expect(affected.has(expr(triple))).toBe(true)
      expect(nextDb.eval(triple)).toBe(12)
      expect(db.eval(triple)).toBe(6)
      expect(triple).toHaveBeenCalledTimes(4)
    })

    it('uses the existing value dependency key for nested ordinary reads', () => {
      const count = createAtom(1)
      const multiply = (factor: number) => count() * factor
      const read = () => multiply(3) + count()
      const db = emptyDatabase.with(count, 2)

      expect(db.eval(read)).toBe(8)
      const [nextDb, affected] = db.withGetAffectedRels(count, 4)
      expect(affected.size).toBe(2)
      expect(affected.has(expr(value, count))).toBe(true)
      expect(affected.has(expr(read))).toBe(true)
      expect(affected.has(expr(count))).toBe(false)
      expect(nextDb.eval(read)).toBe(16)
      expect(db.eval(read)).toBe(8)
    })

    it('recomputes dependent expressions when overridden', () => {
      const db = emptyDatabase
      const v = createAtom('anonymous')
      const greetFunc = vi.fn(() => `hi ${v()}`)

      expect(db.eval(greetFunc)).toBe('hi anonymous')
      expect(greetFunc).toHaveBeenCalledTimes(1)

      const db2 = db.with(v, 'colson')
      expect(db2.eval(greetFunc)).toBe('hi colson')
      expect(greetFunc).toHaveBeenCalledTimes(2)

      // Original database is unchanged
      expect(db.eval(greetFunc)).toBe('hi anonymous')
    })

    it('supports multiple atoms in one computation', () => {
      const db = emptyDatabase
      const first = createAtom('x')
      const second = createAtom(1)
      const combined = () => `${first()}-${second()}`

      expect(db.eval(combined)).toBe('x-1')

      const db2 = db.with(first, 'y').with(second, 2)
      expect(db2.eval(combined)).toBe('y-2')
    })
  })

  describe('database context', () => {
    it('restores and tracks the outer database after a nested evaluation', () => {
      const atom = createAtom('default')
      const outerDb = emptyDatabase.with(atom, 'outer')
      const innerDb = emptyDatabase.with(atom, 'inner')
      const readInner = () => atom()
      const read = vi.fn(() => `${innerDb.eval(readInner)}+${atom()}`)

      expect(outerDb.eval(read)).toBe('inner+outer')
      expect(outerDb.with(atom, 'updated').eval(read)).toBe('inner+updated')
      expect(read).toHaveBeenCalledTimes(2)
      expect(atom()).toBe('default')
    })

    it('restores database context after nested and outer evaluations throw', () => {
      const atom = createAtom('default')
      const outerDb = emptyDatabase.with(atom, 'outer')
      const innerDb = emptyDatabase.with(atom, 'inner')
      const error = new Error('boom')
      const throwing = () => {
        expect(atom()).toBe('inner')
        throw error
      }

      expect(outerDb.eval(() => {
        expect(() => innerDb.eval(throwing)).toThrow(error)
        return atom()
      })).toBe('outer')
      expect(atom()).toBe('default')

      expect(() => innerDb.eval(throwing)).toThrow(error)
      expect(atom()).toBe('default')
    })

    it('restores the surrounding database after nested evaluations and errors', () => {
      const name = createAtom('default')
      const outerDb = emptyDatabase.with(name, 'outer')
      const innerDb = emptyDatabase.with(name, 'inner')
      const error = new Error('boom')
      const throwing = () => {
        expect(name()).toBe('inner')
        throw error
      }
      const read = () => {
        expect(innerDb.eval(name)).toBe('inner')
        expect(() => innerDb.eval(throwing)).toThrow(error)
        return name()
      }

      expect(outerDb.eval(read)).toBe('outer')
      expect(outerDb.with(name, 'updated').eval(read)).toBe('updated')
      expect(() => innerDb.eval(throwing)).toThrow(error)
      expect(name()).toBe('default')
    })
  })

  describe('memoization', () => {
    it('tracks dependencies and invalidates memoized results', () => {
      const count = createAtom(1)
      const read = vi.fn(() => count() * 2)
      const doubled = memoize(read)
      const db = emptyDatabase

      expect(db.eval(doubled)).toBe(2)
      expect(db.eval(doubled)).toBe(2)
      expect(read).toHaveBeenCalledTimes(1)

      const nextDb = db.with(count, 3)
      expect(nextDb.eval(doubled)).toBe(6)
      expect(db.eval(doubled)).toBe(2)
      expect(count()).toBe(1)
      expect(read).toHaveBeenCalledTimes(2)
    })

    it('does not implicitly memoize direct atom calls', () => {
      const count = createAtom(0)
      const db = emptyDatabase.with(count, 10)
      const getAtomValue = vi.spyOn(db, 'getAtomValue')

      expect(db.eval(() => [count(), count()])).toEqual([10, 10])
      expect(getAtomValue).toHaveBeenCalledTimes(2)
      expect(db.eval(count)).toBe(10)
      expect(db.eval(count)).toBe(10)
      expect(getAtomValue).toHaveBeenCalledTimes(4)
      getAtomValue.mockRestore()
    })

    it('supports memoizing an atom directly and invalidates it on changes', () => {
      const count = createAtom(1)
      const cached = memoize(count)
      const db = emptyDatabase.with(count, 2)
      const getAtomValue = vi.spyOn(db, 'getAtomValue')

      expect(db.eval(cached)).toBe(2)
      expect(db.eval(cached)).toBe(2)
      expect(getAtomValue).toHaveBeenCalledTimes(1)
      const nextDb = db.with(count, 3)
      expect(nextDb.eval(cached)).toBe(3)
      expect(db.eval(cached)).toBe(2)
      expect(cached()).toBe(1)
      getAtomValue.mockRestore()
    })
  })

  describe('value compatibility', () => {
    it('reads defaults and assignments through both APIs without changing snapshots', () => {
      const count = createAtom<number | undefined>(0)
      const other = createAtom(0)
      const db = emptyDatabase.with(count, 10)

      expect(typeof count).toBe('function')
      expect(count()).toBe(0)
      expect(value(count)).toBe(0)
      expect(db.eval(count)).toBe(10)
      expect(db.evalExpr(expr(count))).toBe(10)
      expect(db.eval(() => count())).toBe(10)
      expect(db.eval(value, count)).toBe(10)
      expect(db.evalExpr(expr(value, count))).toBe(10)
      expect(db.with(count, undefined).eval(value, count)).toBeUndefined()
      expect(db.eval(other)).toBe(0)
      expect(emptyDatabase.eval(count)).toBe(0)
      expect(count()).toBe(0)
      expect(value(count)).toBe(0)
      expect(count.defaultValue).toBe(0)
    })

    it('invalidates memoized computations and errors that mix both read forms', () => {
      const count = createAtom(1)
      const error = new Error('negative')
      const read = vi.fn(() => {
        const result = count() + value(count)
        if (result < 0) throw error
        return result
      })
      const cached = memoize(read)
      const outer = memoize(() => cached() + 1)
      const db = emptyDatabase.with(count, -1)

      expect(() => db.eval(outer)).toThrow(error)
      expect(() => db.eval(outer)).toThrow(error)
      expect(read).toHaveBeenCalledTimes(1)
      const nextDb = db.with(count, 2)
      expect(nextDb.eval(outer)).toBe(5)
      expect(nextDb.eval(outer)).toBe(5)
      expect(() => db.eval(outer)).toThrow(error)
      expect(read).toHaveBeenCalledTimes(2)
    })

    it.each(['watch', 'watchExpr'] as const)('supports %s with callable atoms alongside value subscriptions', method => {
      const count = createAtom(0)
      const unrelated = createAtom(0)
      const reactor = new Reactor()
      const callback = vi.fn(() => reactor.eval(count))
      const legacyCallback = vi.fn(() => reactor.eval(value, count))
      const unsubscribe = method === 'watch'
        ? reactor.watch(callback, count)
        : reactor.watchExpr(callback, expr(count))
      const unsubscribeLegacy = reactor.watch(legacyCallback, value, count)

      reactor.set(unrelated, 10)
      expect(callback).not.toHaveBeenCalled()
      expect(legacyCallback).not.toHaveBeenCalled()
      reactor.set(count, 2)
      reactor.modify(count, n => n + 1)
      expect(callback.mock.results.map(result => result.value)).toEqual([2, 3])
      expect(legacyCallback.mock.results.map(result => result.value)).toEqual([2, 3])
      expect(reactor.evalExpr(expr(count))).toBe(3)

      unsubscribe()
      unsubscribeLegacy()
      reactor.set(count, 4)
      expect(callback).toHaveBeenCalledTimes(2)
      expect(legacyCallback).toHaveBeenCalledTimes(2)
      expect(count()).toBe(0)
    })
  })
})
