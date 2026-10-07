import { describe, it, expect, vi } from 'vitest'
import { Database } from './database'
import { spyExpr } from './spy'
import { expr } from './expression'
import { Atom, value } from './atom'

describe('Atom', () => {
  it('returns the default value when no override is set', () => {
    const db = new Database()
    const v = new Atom('anonymous')

    expect(db.getResult(expr(value, v))).toBe('anonymous')
  })

  it('returns the default value via spyExpr outside a computation', () => {
    const v = new Atom('anonymous')

    expect(spyExpr(expr(value, v))).toBe('anonymous')
  })

  it('returns the overridden value in the derived database only', () => {
    const db = new Database()
    const v = new Atom('anonymous')
    const atomExpr = expr(value, v)

    const db2 = db.with(v, 'colson')

    expect(db2.getResult(atomExpr)).toBe('colson')
    expect(db.getResult(atomExpr)).toBe('anonymous')
  })

  it('uses reference identity: atoms with equal defaults are independent', () => {
    const db = new Database()
    const v1 = new Atom('same')
    const v2 = new Atom('same')

    expect(expr(value, v1).equals(expr(value, v1))).toBe(true)
    expect(expr(value, v1).equals(expr(value, v2))).toBe(false)

    const db2 = db.with(v1, 'overridden')
    expect(db2.getResult(expr(value, v1))).toBe('overridden')
    expect(db2.getResult(expr(value, v2))).toBe('same')
  })

  it('recomputes dependent expressions when overridden', () => {
    const db = new Database()
    const v = new Atom('anonymous')
    const atomExpr = expr(value, v)
    const greetFunc = vi.fn(() => `hi ${spyExpr(atomExpr)}`)
    const greeting = expr(greetFunc)

    expect(db.getResult(greeting)).toBe('hi anonymous')
    expect(greetFunc).toHaveBeenCalledTimes(1)

    const db2 = db.with(v, 'colson')
    expect(db2.getResult(greeting)).toBe('hi colson')
    expect(greetFunc).toHaveBeenCalledTimes(2)

    // Original database is unchanged
    expect(db.getResult(greeting)).toBe('hi anonymous')
  })

  it('supports multiple atoms in one computation', () => {
    const db = new Database()
    const first = new Atom('x')
    const second = new Atom(1)
    const combined = expr(() => `${spyExpr(expr(value, first))}-${spyExpr(expr(value, second))}`)

    expect(db.getResult(combined)).toBe('x-1')

    const db2 = db.with(first, 'y').with(second, 2)
    expect(db2.getResult(combined)).toBe('y-2')
  })
})
