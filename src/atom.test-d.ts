// @aiUnreviewed

import { describe, expectTypeOf, it } from 'vitest'
import { atom, type Atom, emptyDatabase, expr, memoize, Reactor, useEval, useEvalExpr } from './index'

describe('atom types', () => {
  it('exports Atom only as a type from both entry points', () => {
    type PublicExports = keyof typeof import('./index')
    type ModuleExports = keyof typeof import('./atom')
    expectTypeOf<Extract<PublicExports, 'Atom'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<ModuleExports, 'Atom'>>().toEqualTypeOf<never>()

    // @ts-expect-error Atom is a type, not a constructor.
    new Atom(0)
  })

  it('infers value types without restricting primitives to their initial literals', () => {
    expectTypeOf(atom(0)).toEqualTypeOf<Atom<number>>()
    expectTypeOf(atom('')).toEqualTypeOf<Atom<string>>()
    expectTypeOf(atom(false)).toEqualTypeOf<Atom<boolean>>()
    expectTypeOf(atom({ count: 0 })).toEqualTypeOf<Atom<{ count: number }>>()
    expectTypeOf(atom(undefined)).toEqualTypeOf<Atom<undefined>>()
  })

  it('supports explicit optional and literal-union types', () => {
    const optional = atom<string | undefined>(undefined)
    const choice = atom<'yes' | 'no'>('yes')

    expectTypeOf(optional).toEqualTypeOf<Atom<string | undefined>>()
    expectTypeOf(optional()).toEqualTypeOf<string | undefined>()
    expectTypeOf(choice).toEqualTypeOf<Atom<'yes' | 'no'>>()
    expectTypeOf(choice()).toEqualTypeOf<'yes' | 'no'>()
  })

  it('exposes a zero-argument call signature with the atom value type', () => {
    const count = atom(0)
    expectTypeOf(count()).toEqualTypeOf<number>()
    expectTypeOf(atom<string | undefined>(undefined)()).toEqualTypeOf<string | undefined>()
    expectTypeOf(atom<'yes' | 'no'>('yes')()).toEqualTypeOf<'yes' | 'no'>()
    expectTypeOf(atom({ count: 0 })()).toEqualTypeOf<{ count: number }>()
    const functionDefault = () => 42
    const functionAtom = atom(functionDefault)
    expectTypeOf(functionAtom).toEqualTypeOf<Atom<typeof functionDefault>>()
    expectTypeOf(functionAtom()).toEqualTypeOf<typeof functionDefault>()
    expectTypeOf<Parameters<Atom<number>>>().toEqualTypeOf<[]>()

    // @ts-expect-error Atom calls read values; they do not accept a new value.
    count(1)
    // @ts-expect-error Atoms are not constructors.
    new count()
    // @ts-expect-error A defaultValue property alone does not make a callable atom.
    const notCallable: Atom<number> = { defaultValue: 0 }
  })

  it('infers callable atom results through evaluation, memoization, and hooks', () => {
    const count = atom(0)
    const optional = atom<string | undefined>(undefined)
    const reactor = new Reactor()

    expectTypeOf(expr(count)).toEqualTypeOf<import('./expression').Expression<[], number>>()
    expectTypeOf(emptyDatabase.eval(count)).toEqualTypeOf<number>()
    expectTypeOf(emptyDatabase.evalExpr(expr(optional))).toEqualTypeOf<string | undefined>()
    expectTypeOf(reactor.eval(count)).toEqualTypeOf<number>()
    expectTypeOf(reactor.evalExpr(expr(optional))).toEqualTypeOf<string | undefined>()
    expectTypeOf(memoize(count)).toEqualTypeOf<() => number>()
    expectTypeOf(memoize(optional)()).toEqualTypeOf<string | undefined>()
    expectTypeOf(useEval(reactor, count)).toEqualTypeOf<number>()
    expectTypeOf(useEvalExpr(reactor, expr(optional))).toEqualTypeOf<string | undefined>()
    expectTypeOf(reactor.watch(() => {}, count)).toEqualTypeOf<() => void>()
    expectTypeOf(reactor.watchExpr(() => {}, expr(optional))).toEqualTypeOf<() => void>()
  })

  it('requires a default matching the specified type and keeps it readonly', () => {
    // @ts-expect-error A default value is required.
    atom()
    // @ts-expect-error The default must match the explicit value type.
    atom<number>('wrong')
    const count = atom(0)
    // @ts-expect-error An atom's default is readonly.
    count.defaultValue = 1
  })
})
