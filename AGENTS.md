# CLAUDE.md

This file provides guidance to agents when working with code in this repository.

## Commands

```bash
# Run all tests (watch mode)
npm test

# Run tests once
npm test -- --run

# Run a single test file
npm test -- src/database.test.ts --run

# Build
npm run build

# Clean build artifacts
npm run clean
```

## Architecture

TritiumDB is a reactive, expression-based in-memory database library for TypeScript. It is published as an npm package.

### Core concepts

**Expressions** (`Expression<P>`) are the fundamental unit. An expression is an instance of the `Expression` class, created with the `expr(pred, ...args)` factory function, where:
- `pred` is always a function with signature `(db: Database, ...args: any[]) => any`.
- Remaining elements are the arguments passed after `db` when the predicate is called.

`Expression` implements `ValueObject` (ImmutableJS) for structural equality and hashing, so expressions can be used as `ImmMap`/`ImmSet` keys. Calling `getResult(expr)` executes `pred(db, ...args)` and caches the result. For plain key-value storage, use a no-op predicate function (e.g. `(_db: Database): any => undefined`).

**Dependency tracking** is automatic. During expression computation, any call to `db.spyResult(otherExpr)` records `otherExpr` as a contributor to the currently-computing expression. When a contributor is invalidated, all dependent expressions are invalidated too (breadth-first traversal).

### Key classes and their roles

- **`Database`** (`src/database.ts`): Immutable-style reactive store. Holds three `ImmMap`s keyed by `Expression`: `exprToCachedResult`, `exprToContributorExprs`, `exprToDependentExprs`. Immutable mutation methods (`with`, `withModified`, `withError`, and their `GetAffectedRels` variants) return a new `Database` instance plus the set of affected expressions. The mutable `setDerivative` method is only valid during expression computation.

- **`Reactor`** (`src/reactor.ts`): Mutable wrapper around `Database`. Manages subscriptions and batches subscriber notifications via `flushNotifications()`. Call `set`/`setError`/`modify` to mutate, `subscribe` to listen, `getResult` to read. Also handles async calls via `ensureAsyncRun` and `getEnsuredResultPromise`.

- **`DerivativeId`** (`src/database.ts`): A `ValueObject` that uniquely identifies a derivative expression. Created by calling `db.getDerivativeId(uniqueKey)` during expression computation. Used as a term (not predicate) in expressions set via `db.setDerivative(...)`.

- **`async.ts`**: Helpers for async expressions — `asyncCallStatus`, `asyncCallResult`, `resultIsReady`. Internal predicates are plain functions that return default values (`AsyncCallStatus.NotStarted`, `undefined`, etc.) and key async state in the database.

- **`reactor_hooks.tsx`**: React integration. `useResult(reactor, expr)` subscribes a component to an expression via `useSyncExternalStore`.

### Dependency/invalidation flow

1. `getResult(expr)` → checks cache → on miss, calls `updateExprCacheAndGetResult` (also checks for `DerivativeId` terms and recomputes their creating expressions first).
2. Inside `updateExprCacheAndGetResult`, `currentDeepestComputingExpr` is set so that any nested `spyResult` calls register dependencies.
3. `with(expr, value)` / `set(expr, value)` → `getAllDependentExprsIncludingSeed` finds all transitively dependent expressions → all are invalidated → new value is cached.
4. `Reactor.applyChangeFunc` swaps the `db` reference and queues affected expressions for subscriber notification; `flushNotifications()` dispatches them.

### Recursion protection

If a function predicate's computation triggers `getResult` on the same expression, a `RecursiveExpressionComputationError` is thrown. The exception carries `recursiveExpr` so callers can inspect or handle it. There is special handling in `getResult` for the case where a `DerivativeId`'s creating expression re-enters the derivative expression before it has been cached.
