import { describe, it, expect, vi } from 'vitest'
import { Database, spy } from './database'
import { expr } from './expression'
import { DynamicVar, value } from './dynamic_var'

describe('DynamicVar', () => {
  it('returns the default value when no override is set', () => {
    const db = new Database()
    const v = new DynamicVar('anonymous')

    expect(db.getResult(expr(value, v))).toBe('anonymous')
  })

  it('returns the default value via spy outside a computation', () => {
    const v = new DynamicVar('anonymous')

    expect(spy(expr(value, v))).toBe('anonymous')
  })

  it('returns the overridden value in the derived database only', () => {
    const db = new Database()
    const v = new DynamicVar('anonymous')
    const varExpr = expr(value, v)

    const db2 = db.with(varExpr, 'colson')

    expect(db2.getResult(varExpr)).toBe('colson')
    expect(db.getResult(varExpr)).toBe('anonymous')
  })

  it('uses reference identity: vars with equal defaults are independent', () => {
    const db = new Database()
    const v1 = new DynamicVar('same')
    const v2 = new DynamicVar('same')

    expect(expr(value, v1).equals(expr(value, v1))).toBe(true)
    expect(expr(value, v1).equals(expr(value, v2))).toBe(false)

    const db2 = db.with(expr(value, v1), 'overridden')
    expect(db2.getResult(expr(value, v1))).toBe('overridden')
    expect(db2.getResult(expr(value, v2))).toBe('same')
  })

  it('recomputes dependent expressions when overridden', () => {
    const db = new Database()
    const v = new DynamicVar('anonymous')
    const varExpr = expr(value, v)
    const greetFunc = vi.fn(() => `hi ${spy(varExpr)}`)
    const greeting = expr(greetFunc)

    expect(db.getResult(greeting)).toBe('hi anonymous')
    expect(greetFunc).toHaveBeenCalledTimes(1)

    const db2 = db.with(varExpr, 'colson')
    expect(db2.getResult(greeting)).toBe('hi colson')
    expect(greetFunc).toHaveBeenCalledTimes(2)

    // Original database is unchanged
    expect(db.getResult(greeting)).toBe('hi anonymous')
  })

  it('supports multiple vars in one computation', () => {
    const db = new Database()
    const first = new DynamicVar('x')
    const second = new DynamicVar(1)
    const combined = expr(() => `${spy(expr(value, first))}-${spy(expr(value, second))}`)

    expect(db.getResult(combined)).toBe('x-1')

    const db2 = db.with(expr(value, first), 'y').with(expr(value, second), 2)
    expect(db2.getResult(combined)).toBe('y-2')
  })
})
