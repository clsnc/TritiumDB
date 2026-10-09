import { describe, expectTypeOf, it } from 'vitest'
import { Set as ImmSet } from 'immutable'
import { Atom } from './atom'
import { Database } from './database'
import { Expression } from './expression'

const db = new Database()
const count = new Atom(0)
const name = new Atom('')

describe('Database batch assignment types', () => {
  it('accepts heterogeneous assignments and returns a Database', () => {
    expectTypeOf(db.withMany([count, 10], [name, 'Alice'])).toEqualTypeOf<Database>()
  })

  it('returns a Database and an expression set from the affected-expression variant', () => {
    expectTypeOf(db.withManyGetAffectedRels([count, 10], [name, 'Alice']))
      .toEqualTypeOf<[Database, ImmSet<Expression>]>()
  })

  it('accepts readonly tuple spreads and homogeneous lists', () => {
    const assignments = [[count, 10], [name, 'Alice']] as const
    expectTypeOf(db.withMany(...assignments)).toEqualTypeOf<Database>()
    expectTypeOf(db.withManyGetAffectedRels(...assignments))
      .toEqualTypeOf<[Database, ImmSet<Expression>]>()

    const list: Array<readonly [Atom<number>, number]> = [[count, 1]]
    expectTypeOf(db.withMany(...list)).toEqualTypeOf<Database>()
    expectTypeOf(db.withManyGetAffectedRels(...list))
      .toEqualTypeOf<[Database, ImmSet<Expression>]>()
  })

  it('accepts optional values and literal unions without widening them', () => {
    const optional = new Atom<string | undefined>(undefined)
    const literal = new Atom<'yes' | 'no'>('yes')
    expectTypeOf(db.withMany([optional, undefined], [optional, 'value'], [literal, 'no']))
      .toEqualTypeOf<Database>()

    // @ts-expect-error Literal unions must not widen to string.
    db.withMany([literal, 'maybe'])
    // @ts-expect-error Undefined is not allowed for a non-optional Atom.
    db.withMany([count, undefined])
  })

  it('accepts empty batches', () => {
    expectTypeOf(db.withMany()).toEqualTypeOf<Database>()
    expectTypeOf(db.withManyGetAffectedRels()).toEqualTypeOf<[Database, ImmSet<Expression>]>()
  })

  it('rejects values that do not match their Atoms', () => {
    // @ts-expect-error A value must match its Atom, not widen the inferred type.
    db.withMany([count, 'wrong'])
    // @ts-expect-error Each heterogeneous pair is checked independently.
    db.withMany([name, 'valid'], [count, false])
    // @ts-expect-error The affected-expression variant also checks value types.
    db.withManyGetAffectedRels([count, 'wrong'])
    // @ts-expect-error A readonly spread must retain its Atom/value relationships.
    db.withMany(...([[count, 1], [name, 2]] as const))
  })
})
