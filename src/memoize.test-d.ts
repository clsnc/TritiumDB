import { describe, expectTypeOf, it } from 'vitest'
import { atom, memoize, value } from './index'

describe('memoize types', () => {
  it('preserves argument and return types', () => {
    const original = (name: string, count: number): string => `${name}-${count}`
    const wrapped = memoize(original)

    expectTypeOf(wrapped).toEqualTypeOf<typeof original>()
    expectTypeOf(wrapped('item', 2)).toEqualTypeOf<string>()

    // @ts-expect-error Required arguments must be provided.
    wrapped('item')
    // @ts-expect-error Argument types must match the original function.
    wrapped('item', 'wrong')
    // @ts-expect-error Extra arguments are not accepted.
    wrapped('item', 2, true)
  })

  it('preserves zero-argument functions', () => {
    const wrapped = memoize(() => 42)

    expectTypeOf(wrapped).toEqualTypeOf<() => number>()
    expectTypeOf(wrapped()).toEqualTypeOf<number>()
    // @ts-expect-error The original function takes no arguments.
    wrapped(1)
  })

  it('preserves optional arguments', () => {
    const original = (name: string, count?: number): string => `${name}-${count ?? 1}`
    const wrapped = memoize(original)

    expectTypeOf(wrapped).toEqualTypeOf<typeof original>()
    expectTypeOf(wrapped('item')).toEqualTypeOf<string>()
    expectTypeOf(wrapped('item', 2)).toEqualTypeOf<string>()
    expectTypeOf(wrapped('item', undefined)).toEqualTypeOf<string>()
    // @ts-expect-error Optional arguments retain their types.
    wrapped('item', false)
  })

  it('preserves rest arguments', () => {
    const original = (prefix: string, ...counts: number[]): string => prefix + counts.join(',')
    const wrapped = memoize(original)

    expectTypeOf(wrapped).toEqualTypeOf<typeof original>()
    expectTypeOf(wrapped('item')).toEqualTypeOf<string>()
    expectTypeOf(wrapped('item', 1, 2, 3)).toEqualTypeOf<string>()
    // @ts-expect-error Rest arguments retain their element type.
    wrapped('item', 1, 'wrong')
  })

  it('preserves generic call signatures', () => {
    const identity = <T>(item: T): T => item
    const wrapped = memoize(identity)

    expectTypeOf(wrapped).toExtend<typeof identity>()
    expectTypeOf(identity).toExtend<typeof wrapped>()
    expectTypeOf(wrapped<string>('item')).toEqualTypeOf<string>()
    expectTypeOf(wrapped<number>(2)).toEqualTypeOf<number>()
    expectTypeOf(wrapped({ count: 1 })).toEqualTypeOf<{ count: number }>()
    // @ts-expect-error Explicit type arguments constrain the input.
    wrapped<number>('wrong')
  })

  it('preserves the generic relationship between an Atom and its value', () => {
    const wrapped = memoize(value)

    expectTypeOf(wrapped).toExtend<typeof value>()
    expectTypeOf(value).toExtend<typeof wrapped>()
    expectTypeOf(wrapped(atom(0))).toEqualTypeOf<number>()
    expectTypeOf(wrapped(atom(''))).toEqualTypeOf<string>()
    expectTypeOf(wrapped(atom<string | undefined>(undefined)))
      .toEqualTypeOf<string | undefined>()
    // @ts-expect-error The argument must be an Atom.
    wrapped(0)
    // @ts-expect-error Explicit type arguments constrain the Atom type.
    wrapped<number>(atom(''))
  })
})
