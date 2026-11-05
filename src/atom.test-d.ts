// @aiUnreviewed

import { describe, expectTypeOf, it } from 'vitest'
import { atom, type Atom, value } from './index'

describe('atom types', () => {
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
    expectTypeOf(value(optional)).toEqualTypeOf<string | undefined>()
    expectTypeOf(choice).toEqualTypeOf<Atom<'yes' | 'no'>>()
    expectTypeOf(value(choice)).toEqualTypeOf<'yes' | 'no'>()
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
