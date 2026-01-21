import { describe, it, expect, vi } from 'vitest'
import { Database, DerivativeId, CascadingPredicate } from './database'
import { List as ImmList } from 'immutable'

describe('ReactiveDatabase', () => {
  it('creates a ReactiveDatabase instance', () => {
    const rdb = new Database()

    expect(rdb).toBeInstanceOf(Database)
  })

  it('returns undefined for non-function predicates without cached result', () => {
    const rdb = new Database()
    const expr = ['not-a-function', 'arg1', 'arg2']

    const result = rdb.getResult(expr)
    expect(result).toBeUndefined()
  })

  it('computes result for function predicates', () => {
    const rdb = new Database()
    const func = vi.fn((db, arg) => `computed-${arg}`)
    const expr = [func, 'test-arg']

    const result = rdb.getResult(expr)
    expect(result).toBe('computed-test-arg')
    expect(func).toHaveBeenCalledWith(rdb, 'test-arg')
  })

  it('handles recursive computation by returning undefined', () => {
    const rdb = new Database()
    let recursiveCallCount = 0

    const recursiveFunc = (db: Database, arg: string) => {
      recursiveCallCount++
      if (recursiveCallCount === 1) {
        // First call, trigger recursion
        return db.spyResult([recursiveFunc, arg])
      }
      return 'result'
    }

    const result = rdb.getResult([recursiveFunc, 'test'])
    expect(result).toBeUndefined() // Should return undefined due to recursion detection
    expect(recursiveCallCount).toBe(1) // Should only call once due to recursion protection
  })

  it('creates immutable database with with() method', () => {
    const rdb = new Database()
    const expr = ImmList(['test', 'arg'])
    const result = 'test-result'

    const newDb = rdb.with(expr, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(newDb).not.toBe(rdb) // Should be a new instance
    expect(newDb.getResult(expr)).toBe(result)
    expect(rdb.getResult(expr)).toBeUndefined() // Original unchanged
  })

  it('returns affected expressions with withGetAffectedRels()', () => {
    const rdb = new Database()
    const expr = ImmList(['test', 'arg'])
    const result = 'test-result'

    const [newDb, affectedExprs] = rdb.withGetAffectedRels(expr, result)

    expect(newDb).toBeInstanceOf(Database)
    expect(affectedExprs.has(expr)).toBe(true)
    expect(newDb.getResult(expr)).toBe(result)
  })

  it('allows values to depend on other values', () => {
    const rdb = new Database()

    // Create a base expression
    const baseExpr = ImmList(['base'])
    const db1 = rdb.with(baseExpr, 'base-value')

    // Create a dependent expression that uses the base
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = ImmList([dependentFunc])

    const result = db1.getResult(dependentExpr)
    expect(result).toBe('dependent-base-value')
  })

  it('invalidates dependent expressions when base expression changes', () => {
    const rdb = new Database()

    // Set up base expression
    const baseExpr = ImmList(['base'])
    const db1 = rdb.with(baseExpr, 'value1')

    // Create dependent expression
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = ImmList([dependentFunc])

    // Compute dependent result
    const result1 = db1.getResult(dependentExpr)
    expect(result1).toBe('dependent-value1')

    // Update base expression
    const db2 = db1.with(baseExpr, 'value2')

    // Dependent should be recomputed with new base value
    const result2 = db2.getResult(dependentExpr)
    expect(result2).toBe('dependent-value2')
  })

  it('handles array expressions as well as immutable lists', () => {
    const rdb = new Database()
    const func = vi.fn((db, arg) => `array-${arg}`)
    const arrayExpr = [func, 'test']

    const result = rdb.getResult(arrayExpr)
    expect(result).toBe('array-test')
    expect(func).toHaveBeenCalledWith(rdb, 'test')
  })

  it('handles complex dependency graphs', () => {
    const rdb = new Database()

    // Base expressions
    const base1 = ImmList(['base1'])
    const base2 = ImmList(['base2'])

    // Set base values
    let db = rdb.with(base1, 'value1').with(base2, 'value2')

    // Dependent expressions
    const func1 = (db: Database) => {
      const val1 = db.spyResult(base1)
      return `func1-${val1}`
    }
    const func2 = (db: Database) => {
      const val2 = db.spyResult(base2)
      return `func2-${val2}`
    }
    const func3 = (db: Database) => {
      const val1 = db.spyResult([func1])
      const val2 = db.spyResult([func2])
      return `func3-${val1}-${val2}`
    }

    const dependent1 = ImmList([func1])
    const dependent2 = ImmList([func2])
    const dependent3 = ImmList([func3])

    // Test initial computation
    expect(db.getResult(dependent1)).toBe('func1-value1')
    expect(db.getResult(dependent2)).toBe('func2-value2')
    expect(db.getResult(dependent3)).toBe('func3-func1-value1-func2-value2')

    // Update base1 and check propagation
    db = db.with(base1, 'new-value1')
    expect(db.getResult(dependent1)).toBe('func1-new-value1')
    expect(db.getResult(dependent2)).toBe('func2-value2') // Should be unchanged
    expect(db.getResult(dependent3)).toBe('func3-func1-new-value1-func2-value2')
  })

  it('maintains immutability when creating new instances', () => {
    const rdb = new Database()
    const expr = ImmList(['test'])

    const db1 = rdb.with(expr, 'value1')
    const db2 = db1.with(expr, 'value2')

    // Each database should have its own state
    expect(rdb.getResult(expr)).toBeUndefined()
    expect(db1.getResult(expr)).toBe('value1')
    expect(db2.getResult(expr)).toBe('value2')

    // Original databases should be unchanged
    expect(db1.getResult(expr)).toBe('value1')
  })

  it('handles function expressions with multiple arguments', () => {
    const rdb = new Database()
    const func = vi.fn((db, arg1, arg2, arg3) => `${arg1}-${arg2}-${arg3}`)
    const expr = [func, 'a', 'b', 'c']

    const result = rdb.getResult(expr)
    expect(result).toBe('a-b-c')
    expect(func).toHaveBeenCalledWith(rdb, 'a', 'b', 'c')
  })

  it('handles empty expressions', () => {
    const rdb = new Database()
    const emptyExpr = ImmList([])

    const result = rdb.getResult(emptyExpr)
    expect(result).toBeUndefined()
  })

  it('handles expressions with undefined predicate', () => {
    const rdb = new Database()
    const expr = [undefined, 'arg']

    const result = rdb.getResult(expr)
    expect(result).toBeUndefined()
  })

  it('caches computed results for function expressions', () => {
    const rdb = new Database()
    let callCount = 0

    const func = (db: Database, arg: string) => {
      callCount++
      return `computed-${arg}-${callCount}`
    }
    const expr = [func, 'test']

    // First call should compute
    const result1 = rdb.getResult(expr)
    expect(result1).toBe('computed-test-1')
    expect(callCount).toBe(1)

    // Second call should use cache
    const result2 = rdb.getResult(expr)
    expect(result2).toBe('computed-test-1') // Same result as first call
    expect(callCount).toBe(1) // Function not called again
  })

  it('demonstrates reactive behavior with cascading updates', () => {
    const rdb = new Database()

    // Create a chain of dependent expressions
    const baseExpr = ImmList(['counter'])
    const doubleFunc = (db: Database) => {
      const count = db.spyResult(baseExpr) || 0
      return count * 2
    }
    const doubleExpr = ImmList([doubleFunc])

    const quadrupleFunc = (db: Database) => {
      const doubled = db.spyResult(doubleExpr)
      return doubled * 2
    }
    const quadrupleExpr = ImmList([quadrupleFunc])

    // Initial state
    let db = rdb.with(baseExpr, 5)
    expect(db.getResult(doubleExpr)).toBe(10)
    expect(db.getResult(quadrupleExpr)).toBe(20)

    // Update base value
    db = db.with(baseExpr, 10)
    expect(db.getResult(doubleExpr)).toBe(20)
    expect(db.getResult(quadrupleExpr)).toBe(40)
  })

  it('throws error when getDerivativeId is called outside computation', () => {
    const rdb = new Database()

    expect(() => {
      rdb.getDerivativeId('test-key')
    }).toThrow('getDerivativeId can only be called during expression computation')
  })

  it('throws error when setDerivative is called outside computation', () => {
    const rdb = new Database()

    expect(() => {
      rdb.setDerivative(['test'], 'value')
    }).toThrow('setDerivative can only be called during expression computation')
  })

  it('allows basic usage of getDerivativeId and setDerivative during computation', () => {
    const rdb = new Database()

    const createDerivativeFunc = (db: Database) => {
      const derivativeId = db.getDerivativeId('my-key')
      db.setDerivative(['derivative-expr', derivativeId], 'derivative-value')
      return derivativeId
    }

    const expr = ImmList([createDerivativeFunc])
    const createdDerivativeId = rdb.getResult(expr)

    expect(createdDerivativeId).toBeInstanceOf(DerivativeId)
    expect(createdDerivativeId.creatingExpr).toEqual(expr)
    expect(createdDerivativeId.uniqueKey).toBe('my-key')

    // The derivative expression should be accessible
    const derivativeExpr = ImmList(['derivative-expr', createdDerivativeId])
    expect(rdb.getResult(derivativeExpr)).toBe('derivative-value')
  })

  it('returns consistent DerivativeId for same uniqueKey in same function with same args', () => {
    const rdb = new Database()

    const createDerivativeFunc = (db: Database, arg: string) => {
      const id1 = db.getDerivativeId('same-key')
      const id2 = db.getDerivativeId('same-key')
      return [id1, id2]
    }

    const expr = ImmList([createDerivativeFunc, 'test-arg'])
    const [id1, id2] = rdb.getResult(expr)

    expect(id1).toEqual(id2)
    expect(id1.creatingExpr).toEqual(expr)
    expect(id1.uniqueKey).toBe('same-key')
  })

  it('returns different DerivativeIds for different uniqueKeys or different args', () => {
    const rdb = new Database()

    const createDerivativeFunc = (db: Database, arg: string) => {
      const id1 = db.getDerivativeId('key1')
      const id2 = db.getDerivativeId('key2')
      return [id1, id2]
    }

    const expr1 = ImmList([createDerivativeFunc, 'arg1'])
    const expr2 = ImmList([createDerivativeFunc, 'arg2'])

    const [id1a, id1b] = rdb.getResult(expr1)
    const [id2a, id2b] = rdb.getResult(expr2)

    expect(id1a).not.toEqual(id1b) // different keys
    expect(id1a).not.toEqual(id2a) // different expressions
    expect(id1a.uniqueKey).toBe('key1')
    expect(id1b.uniqueKey).toBe('key2')
    expect(id2a.uniqueKey).toBe('key1')
  })

  it('invalidates derivative expressions when creating expression is invalidated', () => {
    const rdb = new Database()

    // Base expression that the creating function depends on
    const baseExpr = ImmList(['base'])
    let db = rdb.with(baseExpr, 'initial')

    const createDerivativeFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('dependent-key')
      db.setDerivative(['derivative', derivativeId, baseValue], `value-${baseValue}`)
      return derivativeId
    }

    const creatingExpr = ImmList([createDerivativeFunc])
    const derivativeId = db.getResult(creatingExpr)
    const derivativeExpr = ImmList(['derivative', derivativeId, 'initial'])

    expect(db.getResult(derivativeExpr)).toBe('value-initial')

    // Update base expression, which should invalidate the creating expression and thus the derivative
    db = db.with(baseExpr, 'updated')

    // Creating expression should be recomputed with new base value
    const newDerivativeId = db.getResult(creatingExpr)
    const newDerivativeExpr = ImmList(['derivative', newDerivativeId, 'updated'])
    expect(db.getResult(newDerivativeExpr)).toBe('value-updated')
  })

  it('expression results can depend on derivative expression results', () => {
    const rdb = new Database()

    const createDerivativeFunc = (db: Database) => {
      const derivativeId = db.getDerivativeId('test-key')
      db.setDerivative(['derivative', derivativeId], 'computed-value')
      return derivativeId
    }

    const creatingExpr = ImmList([createDerivativeFunc])
    const derivativeId = rdb.getResult(creatingExpr)

    // Create an expression that uses the DerivativeId
    const usingFunc = (db: Database) => {
      const derivativeValue = db.spyResult(['derivative', derivativeId])
      return `using-${derivativeValue}`
    }

    const usingExpr = ImmList([usingFunc])
    const result = rdb.getResult(usingExpr)

    expect(result).toBe('using-computed-value')
  })

  it('handles multiple derivative expressions created within same computation', () => {
    const rdb = new Database()

    const createMultipleDerivativesFunc = (db: Database) => {
      const id1 = db.getDerivativeId('key1')
      const id2 = db.getDerivativeId('key2')

      db.setDerivative(['deriv1', id1], 'value1')
      db.setDerivative(['deriv2', id2], 'value2')

      return [id1, id2]
    }

    const expr = ImmList([createMultipleDerivativesFunc])
    const [id1, id2] = rdb.getResult(expr)

    expect(rdb.getResult(['deriv1', id1])).toBe('value1')
    expect(rdb.getResult(['deriv2', id2])).toBe('value2')
  })

  it('handles derivative expressions that contain other DerivativeIds', () => {
    const rdb = new Database()

    const createNestedDerivativesFunc = (db: Database) => {
      const id1 = db.getDerivativeId('level1')
      const id2 = db.getDerivativeId('level2')

      db.setDerivative(['level1', id1], 'value1')
      db.setDerivative(['level2', id2, id1], 'value2-with-id1')

      return [id1, id2]
    }

    const expr = ImmList([createNestedDerivativesFunc])
    const [id1, id2] = rdb.getResult(expr)

    expect(rdb.getResult(['level1', id1])).toBe('value1')
    expect(rdb.getResult(['level2', id2, id1])).toBe('value2-with-id1')
  })

  it('regular expressions can depend on derivative expressions set within their own computation', () => {
    const rdb = new Database()

    // Create a base expression
    const baseExpr = ImmList(['base'])
    let db = rdb.with(baseExpr, 'base-value')

    // Create a combined function that creates a derivative expression and also depends on it
    const combinedFunc = (db: Database) => {
      // Create the derivative
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('derived')
      db.setDerivative(['derived-expr', derivativeId], `derived-${baseValue}`)

      // Now depend on the derivative
      const derivedValue = db.spyResult(['derived-expr', derivativeId])
      return `dependent-${derivedValue}`
    }

    const combinedExpr = ImmList([combinedFunc])
    const result = db.getResult(combinedExpr)

    expect(result).toBe('dependent-derived-base-value')

    // Update base expression and verify invalidation propagates
    db = db.with(baseExpr, 'new-base-value')
    const newResult = db.getResult(combinedExpr)
    expect(newResult).toBe('dependent-derived-new-base-value')
  })

  it('derivative expressions can depend on regular expressions', () => {
    const rdb = new Database()

    // Create base expressions
    const base1 = ImmList(['base1'])
    const base2 = ImmList(['base2'])
    let db = rdb.with(base1, 'value1').with(base2, 'value2')

    // Create a function that creates a derivative depending on regular expressions
    const createDerivativeFunc = (db: Database) => {
      const val1 = db.spyResult(base1)
      const val2 = db.spyResult(base2)
      const derivativeId = db.getDerivativeId('combined')
      db.setDerivative(['combined', derivativeId], `${val1}-${val2}`)
      return derivativeId
    }

    const creatingExpr = ImmList([createDerivativeFunc])

    // Create a function that accesses the derivative
    const accessDerivativeFunc = (db: Database) => {
      const derivativeId = db.spyResult(creatingExpr)
      return db.spyResult(['combined', derivativeId])
    }

    const accessExpr = ImmList([accessDerivativeFunc])
    expect(db.getResult(accessExpr)).toBe('value1-value2')

    // Update base1 and verify derivative is recomputed
    db = db.with(base1, 'new-value1')
    expect(db.getResult(accessExpr)).toBe('new-value1-value2')
  })

  it('handles complex dependency chains involving derivatives', () => {
    const rdb = new Database()

    // Base expressions
    const baseA = ImmList(['baseA'])
    const baseB = ImmList(['baseB'])
    let db = rdb.with(baseA, 'A').with(baseB, 'B')

    // Level 1: Regular expression depending on base
    const level1Func = (db: Database) => {
      const a = db.spyResult(baseA)
      return `level1-${a}`
    }
    const level1Expr = ImmList([level1Func])

    // Level 2: Derivative depending on level 1
    const level2Func = (db: Database) => {
      const l1 = db.spyResult(level1Expr)
      const derivativeId = db.getDerivativeId('level2')
      db.setDerivative(['level2-expr', derivativeId], `level2-${l1}`)
      return derivativeId
    }
    const level2Expr = ImmList([level2Func])

    // Level 3: Regular expression depending on level 2 derivative
    const level3Func = (db: Database) => {
      const derivativeId = db.spyResult(level2Expr)
      const l2 = db.spyResult(['level2-expr', derivativeId])
      return `level3-${l2}`
    }
    const level3Expr = ImmList([level3Func])

    // Test initial state
    expect(db.getResult(level3Expr)).toBe('level3-level2-level1-A')

    // Update baseA and verify full chain recomputes
    db = db.with(baseA, 'new-A')
    expect(db.getResult(level3Expr)).toBe('level3-level2-level1-new-A')
  })

  it('multiple expressions can depend on the same derivative', () => {
    const rdb = new Database()

    // Create a base value that the derivative depends on
    const baseExpr = ImmList(['base'])
    let db = rdb.with(baseExpr, 'initial')

    const createDerivativeFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('shared')
      db.setDerivative(['shared-deriv', derivativeId], `shared-${baseValue}`)
      return derivativeId
    }

    const creatingExpr = ImmList([createDerivativeFunc])

    // Create multiple dependent expressions that get the current derivativeId
    const dep1Func = (db: Database) => {
      const currentId = db.spyResult(creatingExpr)
      const value = db.spyResult(['shared-deriv', currentId])
      return `dep1-${value}`
    }
    const dep2Func = (db: Database) => {
      const currentId = db.spyResult(creatingExpr)
      const value = db.spyResult(['shared-deriv', currentId])
      return `dep2-${value}`
    }
    const dep3Func = (db: Database) => {
      const currentId = db.spyResult(creatingExpr)
      const value = db.spyResult(['shared-deriv', currentId])
      return `dep3-${value}`
    }

    const dep1Expr = ImmList([dep1Func])
    const dep2Expr = ImmList([dep2Func])
    const dep3Expr = ImmList([dep3Func])

    expect(db.getResult(dep1Expr)).toBe('dep1-shared-initial')
    expect(db.getResult(dep2Expr)).toBe('dep2-shared-initial')
    expect(db.getResult(dep3Expr)).toBe('dep3-shared-initial')

    // Change the base value and verify all dependents update
    db = db.with(baseExpr, 'updated')
    expect(db.getResult(dep1Expr)).toBe('dep1-shared-updated')
    expect(db.getResult(dep2Expr)).toBe('dep2-shared-updated')
    expect(db.getResult(dep3Expr)).toBe('dep3-shared-updated')
  })

  it('derivatives can depend on other derivatives in a chain', () => {
    const rdb = new Database()

    // Create a base value that the first derivative depends on
    const baseExpr = ImmList(['base'])
    let db = rdb.with(baseExpr, 'initial')

    // Expression A: creates first derivative depending on base
    const createFirstFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const id1 = db.getDerivativeId('first')
      db.setDerivative(['first', id1], `first-${baseValue}`)
      return id1
    }
    const exprA = ImmList([createFirstFunc])

    // Expression B: creates second derivative depending on first
    const createSecondFunc = (db: Database) => {
      const id1 = db.spyResult(exprA)
      const firstValue = db.spyResult(['first', id1])
      const id2 = db.getDerivativeId('second')
      db.setDerivative(['second', id2], `second-${firstValue}`)
      return id2
    }
    const exprB = ImmList([createSecondFunc])

    // Expression C: creates third derivative depending on second
    const createThirdFunc = (db: Database) => {
      const id2 = db.spyResult(exprB)
      const secondValue = db.spyResult(['second', id2])
      const id3 = db.getDerivativeId('third')
      db.setDerivative(['third', id3], `third-${secondValue}`)
      return id3
    }
    const exprC = ImmList([createThirdFunc])

    const id3 = db.getResult(exprC)
    expect(db.getResult(['third', id3])).toBe('third-second-first-initial')
    expect(db.getResult(['second', db.getResult(exprB)])).toBe('second-first-initial')
    expect(db.getResult(['first', db.getResult(exprA)])).toBe('first-initial')

    // Change the base value and verify the entire chain updates
    db = db.with(baseExpr, 'changed')
    const newId3 = db.getResult(exprC)
    expect(db.getResult(['third', newId3])).toBe('third-second-first-changed')
    expect(db.getResult(['second', db.getResult(exprB)])).toBe('second-first-changed')
    expect(db.getResult(['first', db.getResult(exprA)])).toBe('first-changed')
  })

  it('old derivative expressions are unset when creating expression recomputes', () => {
    const rdb = new Database()

    // Create a base value
    const baseExpr = ImmList(['base'])
    let db = rdb.with(baseExpr, 'initial')

    // Create a function that produces a derivative depending on the base value
    const createDerivativeFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      const derivativeId = db.getDerivativeId('dependent')
      db.setDerivative(['deriv', derivativeId, baseValue], `value-${baseValue}`)
      return derivativeId
    }

    const creatingExpr = ImmList([createDerivativeFunc])
    const derivativeId = db.getResult(creatingExpr)

    // Access the derivative expression
    const oldDerivativeExpr = ImmList(['deriv', derivativeId, 'initial'])
    expect(db.getResult(oldDerivativeExpr)).toBe('value-initial')

    // Change the base value
    db = db.with(baseExpr, 'changed')

    // The new derivative expression should be accessible
    const newDerivativeExpr = ImmList(['deriv', derivativeId, 'changed'])
    expect(db.getResult(newDerivativeExpr)).toBe('value-changed')

    // The old derivative expression should have been invalidated and not replaced
    expect(db.getResult(oldDerivativeExpr)).toBeUndefined()
  })

  it('creates a CascadingPredicate instance', () => {
    const setter = vi.fn()
    const cascadingPred = new CascadingPredicate(setter)

    expect(cascadingPred).toBeInstanceOf(CascadingPredicate)
    expect(cascadingPred.setter).toBe(setter)
  })

  it('allows basic cascading predicate functionality', () => {
    const rdb = new Database()

    // Create a cascading predicate that sets a related expression
    const parentSetter = (db: Database, expr: ImmList<any>, result: any) => {
      const childId = expr.get(1)
      const parentId = result
      db.setDerivative(['CHILD', parentId], childId)
    }
    const PARENT = new CascadingPredicate(parentSetter)

    // Set a parent relationship
    const parentExpr = ImmList([PARENT, 'B'])
    const db1 = rdb.with(parentExpr, 'A')

    // Check that the child relationship was automatically set
    const childExpr = ImmList(['CHILD', 'A'])
    expect(db1.getResult(childExpr)).toBe('B')
  })

  it('handles cascading predicates that trigger other cascading predicates', () => {
    const rdb = new Database()

    // Create cascading predicates for a chain: PARENT -> CHILD -> GRANDCHILD
    const parentSetter = (db: Database, expr: ImmList<any>, result: any) => {
      const childId = expr.get(1)
      const parentId = result
      db.setDerivative([CHILD, parentId], childId)
    }
    const childSetter = (db: Database, expr: ImmList<any>, result: any) => {
      const parentId = expr.get(1)
      const grandchildId = `grandchild-of-${parentId}`
      db.setDerivative(['GRANDCHILD', parentId], grandchildId)
    }

    const PARENT = new CascadingPredicate(parentSetter)
    const CHILD = new CascadingPredicate(childSetter)

    // Set a parent relationship
    const parentExpr = ImmList([PARENT, 'B'])
    const db1 = rdb.with(parentExpr, 'A')

    // Check the full cascade
    expect(db1.getResult([CHILD, 'A'])).toBe('B')
    expect(db1.getResult(['GRANDCHILD', 'A'])).toBe('grandchild-of-A')
  })

  it('includes cascaded expressions in affected expressions', () => {
    const rdb = new Database()

    // Create a cascading predicate
    const setter = (db: Database, expr: ImmList<any>, result: any) => {
      db.setDerivative(['CASCADE_TARGET', result], 'cascaded-value')
    }
    const CASCADE_PRED = new CascadingPredicate(setter)

    // Set an expression with the cascading predicate
    const cascadeExpr = ImmList([CASCADE_PRED, 'source'])
    const [newDb, affectedExprs] = rdb.withGetAffectedRels(cascadeExpr, 'target-value')

    // Check that the original expression is affected
    expect(affectedExprs.has(cascadeExpr)).toBe(true)
    expect(affectedExprs.has(ImmList(['CASCADE_TARGET', 'target-value'])))
  })

  it('cascading predicates work with reactive dependencies', () => {
    const rdb = new Database()

    // Create a cascading predicate
    const setter = (db: Database, expr: ImmList<any>, result: any) => {
      db.setDerivative(['AUTO_SET', result], `auto-${result}`)
    }
    const CASCADE_PRED = new CascadingPredicate(setter)

    // Create a dependent expression that relies on the cascaded value
    const dependentFunc = (db: Database) => {
      const autoValue = db.spyResult(['AUTO_SET', 'key'])
      return `dependent-${autoValue}`
    }
    const dependentExpr = ImmList([dependentFunc])

    // Set the cascading expression
    const cascadeExpr = ImmList([CASCADE_PRED, 'trigger'])
    const db1 = rdb.with(cascadeExpr, 'key')

    // Check that the dependent expression gets the cascaded value
    expect(db1.getResult(dependentExpr)).toBe('dependent-auto-key')
  })

  it('cascading predicates can set multiple related expressions', () => {
    const rdb = new Database()

    // Create a cascading predicate that sets multiple expressions
    const multiSetter = (db: Database, expr: ImmList<any>, result: any) => {
      const id = expr.get(1)
      db.setDerivative(['FORWARD', id], result)
      db.setDerivative(['REVERSE', result], id)
      db.setDerivative(['META', id, result], 'linked')
    }
    const BI_DIR = new CascadingPredicate(multiSetter)

    // Set the bidirectional relationship
    const biExpr = ImmList([BI_DIR, 'A'])
    const db1 = rdb.with(biExpr, 'B')

    // Check all cascaded expressions were set
    expect(db1.getResult(['FORWARD', 'A'])).toBe('B')
    expect(db1.getResult(['REVERSE', 'B'])).toBe('A')
    expect(db1.getResult(['META', 'A', 'B'])).toBe('linked')
  })

  /* TODO: Find a way to track things such that setters can spy other expression results and dependencies will 
     work correctly.
  it('cascading predicates work with existing reactive dependencies', () => {
    const rdb = new ReactiveDatabase()

    // Set up a base expression that will be referenced in cascade
    const baseExpr = ImmList(['BASE'])
    let db = rdb.with(baseExpr, 'base-value')

    // Create a cascading predicate that references the base expression
    const referencingSetter = (db: ReactiveDatabase, expr: ImmList<any>, result: any) => {
      const baseValue = db.spyResult(baseExpr) // Spy to create dependency
      db.setDerivative(['CASCADE_WITH_BASE', result], `${result}-${baseValue}`)
    }
    const REF_CASCADE = new CascadingPredicate(referencingSetter)

    // Set the cascading expression
    const cascadeExpr = ImmList([REF_CASCADE, 'trigger'])
    db = db.with(cascadeExpr, 'key')

    expect(db.getResult(['CASCADE_WITH_BASE', 'key'])).toBe('key-base-value')

    // Change the base expression result
    db = db.with(baseExpr, 'new-base-value')

    // Verify that the cascading expression result has changed
    expect(db.getResult(['CASCADE_WITH_BASE', 'key'])).toBe('key-new-base-value')
  }) */

  it('withModified creates new database with modified expression result', () => {
    const rdb = new Database()
    const expr = ImmList(['test', 'arg'])
    const initialResult = 'initial-value'

    // Set initial value
    const db1 = rdb.with(expr, initialResult)

    // Modify the expression using withModified
    const modifier = (oldVal: any) => `modified-${oldVal}`
    const db2 = db1.withModified(expr, modifier)

    expect(db2).toBeInstanceOf(Database)
    expect(db2).not.toBe(db1) // Should be a new instance
    expect(db1.getResult(expr)).toBe(initialResult) // Original unchanged
    expect(db2.getResult(expr)).toBe('modified-initial-value') // Modified in new db
  })

  it('withModifiedGetAffectedRels returns affected expressions', () => {
    const rdb = new Database()
    const expr = ImmList(['test', 'arg'])
    const initialResult = 'initial-value'

    // Set initial value
    const db1 = rdb.with(expr, initialResult)

    // Modify the expression using withModifiedGetAffectedRels
    const modifier = (oldVal: any) => `modified-${oldVal}`
    const [db2, affectedExprs] = db1.withModifiedGetAffectedRels(expr, modifier)

    expect(db2).toBeInstanceOf(Database)
    expect(affectedExprs.has(expr)).toBe(true)
    expect(db2.getResult(expr)).toBe('modified-initial-value')
  })

  it('withModified invalidates dependent expressions', () => {
    const rdb = new Database()

    // Set up base expression
    const baseExpr = ImmList(['base'])
    const db1 = rdb.with(baseExpr, 'original')

    // Create dependent expression
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = ImmList([dependentFunc])

    // Compute dependent result
    const result1 = db1.getResult(dependentExpr)
    expect(result1).toBe('dependent-original')

    // Modify base expression using withModified
    const modifier = (oldVal: any) => `${oldVal}-modified`
    const db2 = db1.withModified(baseExpr, modifier)

    // Dependent should be recomputed with new base value
    const result2 = db2.getResult(dependentExpr)
    expect(result2).toBe('dependent-original-modified')
  })

  it('withModified handles undefined initial values', () => {
    const rdb = new Database()
    const expr = ImmList(['nonexistent'])

    // Modify an expression that doesn't have a result (undefined)
    const modifier = (oldVal: any) => oldVal === undefined ? 'default-value' : `modified-${oldVal}`
    const db2 = rdb.withModified(expr, modifier)

    expect(db2.getResult(expr)).toBe('default-value')
  })

  it('withModifiedGetAffectedRels includes dependent expressions in affected set', () => {
    const rdb = new Database()

    // Set up base expression
    const baseExpr = ImmList(['base'])
    const db1 = rdb.with(baseExpr, 'original')

    // Create dependent expression
    const dependentFunc = (db: Database) => {
      const baseValue = db.spyResult(baseExpr)
      return `dependent-${baseValue}`
    }
    const dependentExpr = ImmList([dependentFunc])

    // Compute dependent to establish dependency
    db1.getResult(dependentExpr)

    // Modify base expression and get affected expressions
    const modifier = (oldVal: any) => `${oldVal}-modified`
    const [db2, affectedExprs] = db1.withModifiedGetAffectedRels(baseExpr, modifier)

    // Both base and dependent expressions should be affected
    expect(affectedExprs.has(baseExpr)).toBe(true)
    expect(affectedExprs.has(dependentExpr)).toBe(true)
  })

  it('withModified maintains immutability across multiple modifications', () => {
    const rdb = new Database()
    const expr = ImmList(['counter'])

    const db1 = rdb.with(expr, 0)
    const db2 = db1.withModified(expr, val => val + 1)
    const db3 = db2.withModified(expr, val => val * 2)
    const db4 = db3.withModified(expr, val => val - 3)

    // Each database should have its own state
    expect(rdb.getResult(expr)).toBeUndefined()
    expect(db1.getResult(expr)).toBe(0)
    expect(db2.getResult(expr)).toBe(1)
    expect(db3.getResult(expr)).toBe(2)
    expect(db4.getResult(expr)).toBe(-1)

    // Original databases should be unchanged
    expect(db1.getResult(expr)).toBe(0)
    expect(db2.getResult(expr)).toBe(1)
    expect(db3.getResult(expr)).toBe(2)
  })
})