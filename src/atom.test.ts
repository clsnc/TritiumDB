import { describe, it, expect, vi } from 'vitest'
import { Database } from './database'
import { spy, spyExpr } from './spy'
import { expr } from './expression'
import { Atom, value } from './atom'

describe('Atom', () => {
  it('returns the default value when no override is set', () => {
    const db = new Database()
    const v = new Atom('anonymous')

    expect(db.eval(value, v)).toBe('anonymous')
  })

  it('returns the default value via spyExpr outside a computation', () => {
    const v = new Atom('anonymous')

    expect(spyExpr(expr(value, v))).toBe('anonymous')
  })

  it('returns the overridden value in the derived database only', () => {
    const db = new Database()
    const v = new Atom('anonymous')

    const db2 = db.with(v, 'colson')

    expect(db2.eval(value, v)).toBe('colson')
    expect(db.eval(value, v)).toBe('anonymous')
  })

  it('uses reference identity: atoms with equal defaults are independent', () => {
    const db = new Database()
    const v1 = new Atom('same')
    const v2 = new Atom('same')

    expect(expr(value, v1).equals(expr(value, v1))).toBe(true)
    expect(expr(value, v1).equals(expr(value, v2))).toBe(false)

    const db2 = db.with(v1, 'overridden')
    expect(db2.eval(value, v1)).toBe('overridden')
    expect(db2.eval(value, v2)).toBe('same')
  })

  it('recomputes dependent expressions when overridden', () => {
    const db = new Database()
    const v = new Atom('anonymous')
    const greetFunc = vi.fn(() => `hi ${spy(value, v)}`)

    expect(db.eval(greetFunc)).toBe('hi anonymous')
    expect(greetFunc).toHaveBeenCalledTimes(1)

    const db2 = db.with(v, 'colson')
    expect(db2.eval(greetFunc)).toBe('hi colson')
    expect(greetFunc).toHaveBeenCalledTimes(2)

    // Original database is unchanged
    expect(db.eval(greetFunc)).toBe('hi anonymous')
  })

  it('supports multiple atoms in one computation', () => {
    const db = new Database()
    const first = new Atom('x')
    const second = new Atom(1)
    const combined = () => `${spy(value, first)}-${spy(value, second)}`

    expect(db.eval(combined)).toBe('x-1')

    const db2 = db.with(first, 'y').with(second, 2)
    expect(db2.eval(combined)).toBe('y-2')
  })
})
