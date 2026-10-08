import { describe, it, expect, vi } from 'vitest'
import { Database } from './database'
import { expr } from './expression'
import { Atom, value } from './atom'
import { spy, spyExpr } from './spy'

describe('spyExpr', () => {
  it('outside a computation evaluates the predicate directly without caching', () => {
    let callCount = 0
    const func = vi.fn((arg: string) => {
      callCount++
      return `computed-${arg}-${callCount}`
    })
    const e = expr(func, 'test')

    // No active database, so each spyExpr call re-evaluates
    expect(spyExpr(e)).toBe('computed-test-1')
    expect(spyExpr(e)).toBe('computed-test-2')
    expect(func).toHaveBeenCalledTimes(2)
    expect(func).toHaveBeenCalledWith('test')
  })

  it('computations using another database restore the active database afterwards', () => {
    const base = new Atom<string | undefined>(undefined)
    const baseExpr = expr(value, base)
    const db1 = new Database().with(base, 'db1-value')
    const db2 = new Database().with(base, 'db2-value')

    // A predicate on db1 that reads from db2 via a captured closure,
    // then also spies on a db1-local expression afterwards.
    const outerFunc = vi.fn(() => {
      const fromDb2 = db2.getExprResult(baseExpr)
      const fromDb1 = spyExpr(baseExpr)
      return `${fromDb2}+${fromDb1}`
    })
    const outerExpr = expr(outerFunc)

    expect(db1.getExprResult(outerExpr)).toBe('db2-value+db1-value')

    // The spyExpr after the nested db2 read must still have tracked a
    // dependency within db1: changing db1's base invalidates outerExpr.
    const db1b = db1.with(base, 'db1-new')
    expect(db1b.getExprResult(outerExpr)).toBe('db2-value+db1-new')
    expect(outerFunc).toHaveBeenCalledTimes(2)
  })

  it('restores the active database when a predicate throws', () => {
    const db = new Database()
    const boom = (): any => { throw new Error('boom') }
    const boomExpr = expr(boom)

    expect(() => db.getExprResult(boomExpr)).toThrow('boom')

    // After the throw, there must be no leaked active database:
    // a bare spyExpr call should evaluate plainly instead of caching in db.
    let plainCalls = 0
    const plainFunc = () => {
      plainCalls++
      return `plain-${plainCalls}`
    }
    const plainExpr = expr(plainFunc)
    expect(spyExpr(plainExpr)).toBe('plain-1')
    expect(spyExpr(plainExpr)).toBe('plain-2')
    expect(plainCalls).toBe(2)
  })
})

describe('spy', () => {
  it('evaluates a function with no arguments', () => {
    const func = vi.fn(() => 'result')

    const result: string = spy(func)

    expect(result).toBe('result')
    expect(func).toHaveBeenCalledWith()
    expect(func).toHaveBeenCalledTimes(1)
  })

  it('passes multiple arguments to the function', () => {
    const func = vi.fn((name: string, count: number) => `${name}-${count}`)

    const result: string = spy(func, 'item', 2)

    expect(result).toBe('item-2')
    expect(func).toHaveBeenCalledWith('item', 2)
    expect(func).toHaveBeenCalledTimes(1)
  })

  it('outside a computation evaluates directly without caching', () => {
    let callCount = 0
    const func = vi.fn((arg: string) => `${arg}-${++callCount}`)

    expect(spy(func, 'test')).toBe('test-1')
    expect(spy(func, 'test')).toBe('test-2')
    expect(func).toHaveBeenCalledTimes(2)
  })

  it('shares cached results with spyExpr for the same function and arguments', () => {
    const db = new Database()
    const func = vi.fn((n: number) => n * 2)
    const combined = expr(() => [
      spy(func, 2),
      spyExpr(expr(func, 2)),
      spy(func, 2),
      spy(func, 3)
    ])

    expect(db.getExprResult(combined)).toEqual([4, 4, 4, 6])
    expect(db.getExprResult(expr(func, 2))).toBe(4)
    expect(func).toHaveBeenCalledTimes(2)
    expect(func).toHaveBeenNthCalledWith(1, 2)
    expect(func).toHaveBeenNthCalledWith(2, 3)
  })
})
