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

**Expressions** (`ListyExpr` / `ImmExpr`) are the fundamental unit. An expression is an array/list where:
- The first element (the "predicate") is either a function or an arbitrary value used as a key.
- Remaining elements are arguments.

When the predicate is a function, calling `getResult(expr)` executes `pred(db, ...args)` and caches the result. When the predicate is a non-function value, the expression acts as a plain key-value store entry.

**Dependency tracking** is automatic. During expression computation, any call to `db.spyResult(otherExpr)` records `otherExpr` as a contributor to the currently-computing expression. When a contributor is invalidated, all dependent expressions are invalidated too (breadth-first traversal).

### Key classes and their roles

- **`Database`** (`src/database.ts`): Immutable-style reactive store. Holds three `ImmMap`s: `exprToCachedResult`, `exprToContributorExprs`, `exprToDependentExprs`. Mutation methods (`with`, `withModified`, etc.) return a new `Database` instance plus the set of affected expressions. Mutable methods (`setDerivative`) are only valid during expression computation.

- **`Reactor`** (`src/reactor.ts`): Mutable wrapper around `Database`. Manages subscriptions and batches subscriber notifications via `flushNotifications()`. Call `set`/`setError`/`modify` to mutate, `subscribe` to listen, `getResult` to read. Also handles async calls via `ensureAsyncRun` and `getEnsuredResultPromise`.

- **`DerivativeId`** (`src/database.ts`): An immutable Record that uniquely identifies a derivative expression. Created by calling `db.getDerivativeId(uniqueKey)` during expression computation. Used as a predicate or term in expressions set via `db.setDerivative(...)`.

- **`CascadingPredicate`** (`src/database.ts`): A predicate wrapper whose `setter` function is called whenever the expression is set, allowing one `set` to trigger additional derivative `set`s (a cascade).

- **`async.ts`**: Helpers for async expressions — `asyncCallStatus`, `asyncCallResult`, `resultIsReady`. Internal predicates (plain `{}` objects) key async state in the database.

- **`reactor_hooks.tsx`**: React integration. `useResult(reactor, expr)` subscribes a component to an expression via `useSyncExternalStore`.

### Dependency/invalidation flow

1. `getResult(expr)` → checks cache → if miss and predicate is a function, calls `updateExprCacheAndGetResult`.
2. Inside that call, `currentDeepestComputingExpr` is set so that any nested `spyResult` calls register dependencies.
3. `with(expr, value)` / `set(expr, value)` → `getAllDependentExprsIncludingSeed` finds all transitively dependent expressions → all are invalidated → new value is cached.
4. `Reactor.applyChangeFunc` swaps the `db` reference and queues affected expressions for subscriber notification; `flushNotifications()` dispatches them.

### Recursion protection

If a function predicate's computation triggers `getResult` on the same expression, a `RecursiveExpressionComputationError` is thrown. The exception carries `recursiveExpr` so callers can inspect or handle it. There is special handling in `getResultFromImmExpr` for the case where a `DerivativeId`'s creating expression re-enters the derivative expression before it has been cached.
