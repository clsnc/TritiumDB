// @aiUnreviewed

import { describe, expectTypeOf, it } from 'vitest'
import { Atom, expr, memoize, Reactor, useEval, useEvalExpr, value } from './index'

const reactor = new Reactor()

describe('React hook types', () => {
  it('infers atom value types, including undefined', () => {
    const count = new Atom(0)
    const optional = new Atom<string | undefined>(undefined)

    expectTypeOf(useEval(reactor, value, count)).toEqualTypeOf<number>()
    expectTypeOf(useEvalExpr(reactor, expr(value, count))).toEqualTypeOf<number>()
    expectTypeOf(useEval(reactor, value, optional)).toEqualTypeOf<string | undefined>()
    expectTypeOf(useEvalExpr(reactor, expr(value, optional))).toEqualTypeOf<string | undefined>()
  })

  it('preserves structured results and accepts memoized predicates', () => {
    const select = () => ({ count: 1, label: 'item' })
    const wrapped = memoize(select)

    expectTypeOf(useEval(reactor, select)).toEqualTypeOf<ReturnType<typeof select>>()
    expectTypeOf(useEvalExpr(reactor, expr(select))).toEqualTypeOf<ReturnType<typeof select>>()
    expectTypeOf(useEval(reactor, wrapped)).toEqualTypeOf<ReturnType<typeof select>>()
    expectTypeOf(useEvalExpr(reactor, expr(wrapped))).toEqualTypeOf<ReturnType<typeof select>>()
  })

  it('accepts optional and rest arguments', () => {
    const optional = (label: string, count?: number) => `${label}-${count ?? 0}`
    const rest = (label: string, ...counts: number[]) => label + counts.join(',')

    expectTypeOf(useEval(reactor, optional, 'item')).toEqualTypeOf<string>()
    expectTypeOf(useEvalExpr(reactor, expr(optional, 'item', 2))).toEqualTypeOf<string>()
    expectTypeOf(useEval(reactor, rest, 'item', 1, 2)).toEqualTypeOf<string>()
    expectTypeOf(useEvalExpr(reactor, expr(rest, 'item', 1, 2))).toEqualTypeOf<string>()
  })

  it('rejects missing or incorrect arguments and non-expressions', () => {
    const select = (label: string, count: number) => `${label}-${count}`

    // @ts-expect-error Required arguments must be provided.
    useEval(reactor, select, 'item')
    // @ts-expect-error Argument types must match the predicate.
    useEval(reactor, select, 'item', 'wrong')
    // @ts-expect-error Extra arguments are not accepted.
    useEval(reactor, select, 'item', 2, true)
    // @ts-expect-error useEvalExpr requires an Expression rather than a predicate.
    useEvalExpr(reactor, select)
  })
})
