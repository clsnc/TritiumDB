import { describe, it, expect } from 'vitest'
import { Database, expr } from './database'
import { ReactiveEntity, property, method, callMethod } from './entities'

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

describe('method', () => {
    it('returns the function stored as an entity property', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({
                greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
            })
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        const greetFn = db.getResult(expr(method, entity, 'greet'))
        expect(typeof greetFn).toBe('function')
    })

    it('returned function works correctly in an expression', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({
                greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
            })
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        const greetExpr = expr(method, entity, 'greet')
        const greetFn = db.getResult(greetExpr)
        const result = db.getResult(expr(greetFn, entity, 'Alice'))
        expect(result).toBe('Hello Alice')
    })

    it('returned function can use db to spy on expressions', () => {
        const db = new Database()
        const base = (_db: Database): any => undefined
        const baseExpr = expr(base)
        let currentDb = db.with(baseExpr, 'greeting')

        const createFunc = (db: Database) => {
            const greeting = db.spyResult(baseExpr)
            return db.createEntity({
                greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `${greeting} ${name}`
            })
        }
        const e = expr(createFunc)
        const entity = currentDb.getResult(e)

        const consumerFunc = (db: Database) => {
            const currentEntity = db.spyResult(e)
            const fn = db.getResult(expr(method, currentEntity, 'greet'))
            return db.getResult(expr(fn, currentEntity, 'Bob'))
        }
        const consumerExpr = expr(consumerFunc)

        expect(currentDb.getResult(consumerExpr)).toBe('greeting Bob')

        currentDb = currentDb.with(baseExpr, 'Hi')
        expect(currentDb.getResult(consumerExpr)).toBe('Hi Bob')
    })

    it('returned function can use entity to reference the entity', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({
                name: 'Alice',
                greeting: (db: Database, entity: ReactiveEntity<any>) => {
                    const name = db.getResult(expr(property, entity, 'name'))
                    return `Hi, I'm ${name}`
                }
            })
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        const greetingExpr = expr(method, entity, 'greeting')
        const greetingFn = db.getResult(greetingExpr)
        const result = db.getResult(expr(greetingFn, entity))
        expect(result).toBe("Hi, I'm Alice")
    })

    // TODO: Find a better way to validate type inference
    it('type error when property is not a function', () => {
        // Code is wrapped in a function so that it doesn't get executed (because it is only there to check type inference)
        () => {
            const db = new Database()
            const createFunc = (db: Database) => {
                return db.createEntity({ name: 'Alice' })
            }
            const e = expr(createFunc)
            const entity = db.getResult(e)

            // @ts-expect-error 'name' is a string, not a method
            db.getResult(expr(method, entity, 'name'))
        }
    })

    it('type inference on returned function args', () => {
        () => {
            const db = new Database()
            const createFunc = (db: Database) => {
                return db.createEntity({
                    greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
                })
            }
            const e = expr(createFunc)
            const entity = db.getResult(e)

            const greetFn = db.getResult(expr(method, entity, 'greet'))

            // Correct usage compiles
            db.getResult(expr(greetFn, entity, 'Alice'))

            // @ts-expect-error wrong arg type: number is not assignable to string
            db.getResult(expr(greetFn, entity, 42))
        }
    })

    it('type inference on returned function arg count', () => {
        () => {
            const db = new Database()
            const createFunc = (db: Database) => {
                return db.createEntity({
                    greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
                })
            }
            const e = expr(createFunc)
            const entity = db.getResult(e)

            const greetFn = db.getResult(expr(method, entity, 'greet'))

            // @ts-expect-error too few args: missing required 'name' argument
            db.getResult(expr(greetFn, entity))
        }
    })

    it('type inference on returned function return type', () => {
        () => {
            const db = new Database()
            const createFunc = (db: Database) => {
                return db.createEntity({
                    greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
                })
            }
            const e = expr(createFunc)
            const entity = db.getResult(e)

            const greetFn = db.getResult(expr(method, entity, 'greet'))
            const result: string = db.getResult(expr(greetFn, entity, 'Alice'))

            // @ts-expect-error string is not assignable to number
            const badResult: number = db.getResult(expr(greetFn, entity, 'Alice'))
        }
    })
})

describe('callMethod', () => {
    it('calls a method with args in a single expression', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({
                greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
            })
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        const result = db.getResult(expr(callMethod, entity, 'greet', 'Alice'))
        expect(result).toBe('Hello Alice')
    })

    it('works with no user args', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({
                greeting: (db: Database, entity: ReactiveEntity<any>) => 'Hi there'
            })
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        const result = db.getResult(expr(callMethod, entity, 'greeting'))
        expect(result).toBe('Hi there')
    })

    it('method can use db to spy on expressions', () => {
        const db = new Database()
        const base = (_db: Database): any => undefined
        const baseExpr = expr(base)
        let currentDb = db.with(baseExpr, 'greeting')

        const createFunc = (db: Database) => {
            const greeting = db.spyResult(baseExpr)
            return db.createEntity({
                greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `${greeting} ${name}`
            })
        }
        const e = expr(createFunc)
        const entity = currentDb.getResult(e)

        const consumerFunc = (db: Database) => {
            const currentEntity = db.spyResult(e)
            return db.spyResult(expr(callMethod, currentEntity, 'greet', 'Bob'))
        }
        const consumerExpr = expr(consumerFunc)

        expect(currentDb.getResult(consumerExpr)).toBe('greeting Bob')

        currentDb = currentDb.with(baseExpr, 'Hi')
        expect(currentDb.getResult(consumerExpr)).toBe('Hi Bob')
    })

    it('method can use entity to access properties', () => {
        const db = new Database()
        const createFunc = (db: Database) => {
            return db.createEntity({
                name: 'Alice',
                greeting: (db: Database, entity: ReactiveEntity<any>) => {
                    const name = db.getResult(expr(property, entity, 'name'))
                    return `Hi, I'm ${name}`
                }
            })
        }
        const e = expr(createFunc)
        const entity = db.getResult(e)

        const result = db.getResult(expr(callMethod, entity, 'greeting'))
        expect(result).toBe("Hi, I'm Alice")
    })

    it('type error on invalid method name', () => {
        () => {
            const db = new Database()
            const createFunc = (db: Database) => {
                return db.createEntity({ name: 'Alice' })
            }
            const e = expr(createFunc)
            const entity = db.getResult(e)

            // @ts-expect-error 'name' is a string, not a method
            db.getResult(expr(callMethod, entity, 'name'))
        }
    })

    it('type error on wrong arg type', () => {
        () => {
            const db = new Database()
            const createFunc = (db: Database) => {
                return db.createEntity({
                    greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
                })
            }
            const e = expr(createFunc)
            const entity = db.getResult(e)

            // @ts-expect-error number is not assignable to string
            db.getResult(expr(callMethod, entity, 'greet', 42))
        }
    })

    it('type error on wrong return type usage', () => {
        () => {
            const db = new Database()
            const createFunc = (db: Database) => {
                return db.createEntity({
                    greet: (db: Database, entity: ReactiveEntity<any>, name: string) => `Hello ${name}`
                })
            }
            const e = expr(createFunc)
            const entity = db.getResult(e)

            // @ts-expect-error string is not assignable to number
            const badResult: number = db.getResult(expr(callMethod, entity, 'greet', 'Alice'))
        }
    })
})
