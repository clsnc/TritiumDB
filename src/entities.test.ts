import { describe, it, expect } from 'vitest'
import { Database, expr } from './database'
import { ReactiveEntity, property } from './entities'

describe('ReactiveEntity', () => {
    it('implements ValueObject with structural equality', () => {
        const a = new ReactiveEntity(1)
        const b = new ReactiveEntity(1)
        const c = new ReactiveEntity(2)

        expect(a.equals(b)).toBe(true)
        expect(a.equals(c)).toBe(false)
        expect(a.hashCode()).toBe(1)
        expect(b.hashCode()).toBe(1)
        expect(c.hashCode()).toBe(2)
    })

    it('equals returns false for non-entity values', () => {
        const entity = new ReactiveEntity(1)
        expect(entity.equals(null)).toBe(false)
        expect(entity.equals(undefined)).toBe(false)
        expect(entity.equals(1)).toBe(false)
        expect(entity.equals({ id: 1 })).toBe(false)
    })
})

describe('createEntity', () => {
    it('creates an entity and stores properties as derivative expressions', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({ name: 'Alice', age: 30 })
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        expect(entity).toBeInstanceOf(ReactiveEntity)
        expect(db.getResult(expr(property, entity, 'name'))).toBe('Alice')
        expect(db.getResult(expr(property, entity, 'age'))).toBe(30)
    })

    it('returns entities with sequential ids', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            const e1 = db.createEntity({ x: 1 })
            const e2 = db.createEntity({ x: 2 })
            return [e1, e2]
        }
        const e = expr(createFunc)
        const [entity1, entity2] = db.getResult(e)

        expect(entity1.id).not.toBe(entity2.id)
    })

    it('properties are invalidated when the creating expression recomputes', () => {
        const db = new Database()
        const base = (_db: Database): any => undefined
        const baseExpr = expr(base)
        let currentDb = db.with(baseExpr, 'initial')

        const createFunc = (db: Database) => {
            const label = db.spyResult(baseExpr)
            return db.createEntity({ label })
        }
        const e = expr(createFunc)
        const entity = currentDb.getResult(e)

        expect(currentDb.getResult(expr(property, entity, 'label'))).toBe('initial')

        currentDb = currentDb.with(baseExpr, 'updated')
        // The creating expression should recompute, producing a new entity
        const newEntity = currentDb.getResult(e)
        expect(currentDb.getResult(expr(property, newEntity, 'label'))).toBe('updated')
        expect(newEntity).not.toBe(entity)
    })

    it('supports multiple entities with independent properties', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            const alice = db.createEntity({ name: 'Alice' })
            const bob = db.createEntity({ name: 'Bob' })
            return { alice, bob }
        }
        const e = expr(createFunc)
        const { alice, bob } = db.getResult(e)

        expect(db.getResult(expr(property, alice, 'name'))).toBe('Alice')
        expect(db.getResult(expr(property, bob, 'name'))).toBe('Bob')
        expect(alice.id).not.toBe(bob.id)
    })

    it('properties participate in dependency tracking', () => {
        const db = new Database()
        const base = (_db: Database): any => undefined
        const baseExpr = expr(base)
        let currentDb = db.with(baseExpr, 'hello')

        const createFunc = (db: Database) => {
            const val = db.spyResult(baseExpr)
            return db.createEntity({ msg: val })
        }
        const e = expr(createFunc)
        const entity = currentDb.getResult(e)

        // A consumer that reads the entity property
        const consumerFunc = (db: Database) => {
            const currentEntity = db.spyResult(e)
            return db.spyResult(expr(property, currentEntity, 'msg'))
        }
        const consumerExpr = expr(consumerFunc)

        expect(currentDb.getResult(consumerExpr)).toBe('hello')

        currentDb = currentDb.with(baseExpr, 'world')
        expect(currentDb.getResult(consumerExpr)).toBe('world')
    })

    it('entity with empty entries creates an entity with no properties', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({})
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        expect(entity).toBeInstanceOf(ReactiveEntity)
        // @ts-expect-error There should be no 'anything' key
        expect(() => db.getResult(expr(property, entity, 'anything'))).toThrow()
    })
})
