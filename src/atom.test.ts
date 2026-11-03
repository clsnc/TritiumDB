// @aiUnreviewed

import { describe, it, expect, vi } from 'vitest'
import { emptyDatabase } from './database'
import { expr } from './expression'
import { Atom, value } from './atom'

describe('Atom', () => {
  describe('direct value reads', () => {
    it('returns the default outside evaluation, including after an overridden read', () => {
      const atom = new Atom('default')
      const db = emptyDatabase.with(atom, 'assigned')

      expect(value(atom)).toBe('default')
      expect(db.eval(() => value(atom))).toBe('assigned')
      expect(value(atom)).toBe('default')
    })

    it('reads and tracks atoms through nested ordinary helpers', () => {
      const atom = new Atom(1)
      const multiply = (factor: number) => value(atom) * factor
      const triple = vi.fn(() => multiply(3))
      const db = emptyDatabase.with(atom, 2)

      expect(db.eval(triple)).toBe(6)
      expect(db.eval(triple)).toBe(6)
      expect(triple).toHaveBeenCalledTimes(1)

      const [nextDb, affected] = db.withGetAffectedRels(atom, 4)
      expect(affected.size).toBe(2)
      expect(affected.has(expr(value, atom))).toBe(true)
      expect(affected.has(expr(triple))).toBe(true)
      expect(nextDb.eval(triple)).toBe(12)
      expect(db.eval(triple)).toBe(6)
      expect(triple).toHaveBeenCalledTimes(2)
    })

    it('returns explicit undefined assignments instead of the default', () => {
      const atom = new Atom<string | undefined>('default')
      const db = emptyDatabase.with(atom, undefined)

      expect(db.eval(() => value(atom))).toBeUndefined()
      expect(value(atom)).toBe('default')
    })

    it('restores and tracks the outer database after a nested evaluation', () => {
      const atom = new Atom('default')
      const outerDb = emptyDatabase.with(atom, 'outer')
      const innerDb = emptyDatabase.with(atom, 'inner')
      const readInner = () => value(atom)
      const read = vi.fn(() => `${innerDb.eval(readInner)}+${value(atom)}`)

      expect(outerDb.eval(read)).toBe('inner+outer')
      expect(outerDb.with(atom, 'updated').eval(read)).toBe('inner+updated')
      expect(read).toHaveBeenCalledTimes(2)
      expect(value(atom)).toBe('default')
    })

    it('restores database context after nested and outer evaluations throw', () => {
      const atom = new Atom('default')
      const outerDb = emptyDatabase.with(atom, 'outer')
      const innerDb = emptyDatabase.with(atom, 'inner')
      const error = new Error('boom')
      const throwing = () => {
        expect(value(atom)).toBe('inner')
        throw error
      }

      expect(outerDb.eval(() => {
        expect(() => innerDb.eval(throwing)).toThrow(error)
        return value(atom)
      })).toBe('outer')
      expect(value(atom)).toBe('default')

      expect(() => innerDb.eval(throwing)).toThrow(error)
      expect(value(atom)).toBe('default')
    })
  })

  it('returns the default value when no override is set', () => {
    const db = emptyDatabase
    const v = new Atom('anonymous')

    expect(db.eval(value, v)).toBe('anonymous')
  })

  it('returns the default value outside a computation', () => {
    const v = new Atom('anonymous')

    expect(value(v)).toBe('anonymous')
  })

  it('returns the overridden value in the derived database only', () => {
    const db = emptyDatabase
    const v = new Atom('anonymous')

    const db2 = db.with(v, 'colson')

    expect(db2.eval(value, v)).toBe('colson')
    expect(db.eval(value, v)).toBe('anonymous')
  })

  it('uses reference identity: atoms with equal defaults are independent', () => {
    const db = emptyDatabase
    const v1 = new Atom('same')
    const v2 = new Atom('same')

    expect(expr(value, v1).equals(expr(value, v1))).toBe(true)
    expect(expr(value, v1).equals(expr(value, v2))).toBe(false)

    const db2 = db.with(v1, 'overridden')
    expect(db2.eval(value, v1)).toBe('overridden')
    expect(db2.eval(value, v2)).toBe('same')
  })

  it('recomputes dependent expressions when overridden', () => {
    const db = emptyDatabase
    const v = new Atom('anonymous')
    const greetFunc = vi.fn(() => `hi ${value(v)}`)

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
    const first = new Atom('x')
    const second = new Atom(1)
    const combined = () => `${value(first)}-${value(second)}`

    expect(db.eval(combined)).toBe('x-1')

    const db2 = db.with(first, 'y').with(second, 2)
    expect(db2.eval(combined)).toBe('y-2')
  })
})
