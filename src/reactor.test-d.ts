import { describe, expectTypeOf, it } from 'vitest'
import { Atom } from './atom'
import { Reactor } from './reactor'

const reactor = new Reactor()
const count = new Atom(0)
const name = new Atom('')

describe('Reactor batch assignment types', () => {
  it('accepts mutable and readonly tuple spreads and lists', () => {
    const mutable: [[Atom<number>, number], [Atom<string>, string]] = [[count, 10], [name, 'Alice']]
    expectTypeOf(reactor.setMany(...mutable)).toEqualTypeOf<void>()

    const readonly = [[count, 10], [name, 'Alice']] as const
    expectTypeOf(reactor.setMany(...readonly)).toEqualTypeOf<void>()

    const list: Array<[Atom<number>, number]> = [[count, 1]]
    expectTypeOf(reactor.setMany(...list)).toEqualTypeOf<void>()
  })

  it('rejects values that do not match their Atoms', () => {
    // @ts-expect-error A value must match its Atom, not widen the inferred type.
    reactor.setMany([count, 'wrong'])
    // @ts-expect-error Each heterogeneous pair is checked independently.
    reactor.setMany([name, 'valid'], [count, false])
  })
})
