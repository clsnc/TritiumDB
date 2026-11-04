# TritiumDB

TritiumDB is a functional reactive in-memory database for JavaScript and TypeScript projects.

**This project is in alpha. Expect breaking changes.**

## `Atom`

An `Atom` is the basic unit from which application state is built. We are going to demonstrate an application that counts up as it is clicked, so our state must include a click count. An `Atom` must have a default value, so we set that to `0` clicks.

```js
import { Atom } from 'tritiumdb'

const clickCountAtom = new Atom(0) // Assume 0 clicks by default
```

Though Atoms can be associated with non-default values, an `Atom` object itself only stores its default value and will never change. We will see how to associate it with other values in the next section.

## `Database`

A `Database` is an immutable snapshot of application state. In other words, a given `Database` always has the same value for any given `Atom`. We can check an `Atom`'s value in a `Database` by calling `Database.eval` with the `value` function and the `Atom`. By default, a `Database` has default values for all `Atom`s.

```js
import { emptyDatabase, value } from 'tritiumdb'

console.log(emptyDatabase.eval(value, clickCountAtom)) // Output: 0 (clickCountAtom's default value)
```

Because `Database` instances are immutable, we must construct a new `Database` to assign a different value to an `Atom`. Notice that even after the new `oneClickDb` has been created, `emptyDatabase` hasn't changed.

```js
const oneClickDb = emptyDatabase.with(clickCountAtom, 1)
console.log(oneClickDb.eval(value, clickCountAtom)) // Output: 1
console.log(emptyDatabase.eval(value, clickCountAtom)) // Output: 0 (emptyDatabase hasn't changed)
```

A `Database` can also evaluate functions that use its `Atom` values.

```js
function multiplyClicks(multiplier) {
  const numClicks = value(clickCountAtom) // Establish dependency on a Database's clickCountAtom value
  return numClicks * multiplier
}

console.log(emptyDatabase.eval(multiplyClicks, 5)) // Output: 0
console.log(oneClickDb.eval(multiplyClicks, 5)) // Output: 5
```

Function calls that depend on `Atom` values can be nested arbitrarily.

```js
function tripleClicks() {
  return multiplyClicks(3)
}

console.log(oneClickDb.eval(tripleClicks)) // Output: 3
console.log(emptyDatabase.eval(tripleClicks)) // Output: 0
```

Because a `Database`'s `Atom` values never change, the result of a function evaluation in a given `Database` can be cached. You can create a cached version of your function using `memoize`. Calling `memoize` repeatedly with the same function or with a memoizing wrapper returns the same wrapper. Because side effects aren't guaranteed to be repeated, you should only use pure functions in most cases.

```js
import { memoize } from 'tritiumdb'

const multiplyClicksLoudly = memoize((multiplier) => {
  const numClicks = value(clickCountAtom) // Establish dependency on a Database's clickCountAtom value
  console.log(`MULTIPLYING ${numClicks} by ${multiplier}!`)
  return numClicks * multiplier
})

emptyDatabase.eval(multiplyClicksLoudly, 5) // Output: "MULTIPLYING 0 by 5!"
oneClickDb.eval(multiplyClicksLoudly, 5) // Output: "MULTIPLYING 1 by 5!"
emptyDatabase.eval(multiplyClicksLoudly, 5) // No output because the evaluation result is cached
oneClickDb.eval(multiplyClicksLoudly, 5) // No output because the evaluation result is cached
``` 

## `Reactor`

A `Reactor` manages changing state. Internally, it stores a `Database` and swaps it out for a different one whenever something changes. For most applications, you'll want to work with `Reactor` rather than with `Database` directly. We can evaluate function calls from a `Reactor` just as we can with a `Database`.

```js
import { Reactor } from 'tritiumdb'

const reactor = new Reactor() // If no Database is provided, emptyDatabase is used
console.log(reactor.eval(multiplyClicks, 8)) // Output: 0 (because clickCountAtom's default value is 0)
```

We can change a `Reactor`'s value for an `Atom` with `Reactor.set` and `Reactor.modify`.

```js
reactor.set(clickCountAtom, 10) // Set clickCountAtom's value in this Reactor to 10
console.log(reactor.eval(value, clickCountAtom)) // Output: 10
console.log(reactor.eval(tripleClicks)) // Output: 30

reactor.modify(clickCountAtom, count => count + 1) // Increase clickCountAtom's value in this Reactor by 1
console.log(reactor.eval(value, clickCountAtom)) // Output: 11
console.log(reactor.eval(tripleClicks)) // Output: 33
```

Sometimes we want to take an action when some part of the application state changes. `Reactor.watch` lets us subscribe to be notified when a function call's return value may have changed. It returns a function that can be used to unsubscribe at any time.

```js
function handle20xClicksChange() {
  console.log(`Changed to ${reactor.eval(multiplyClicks, 20)}`)
}

const unsubscribe = reactor.watch(handle20xClicksChange, multiplyClicks, 20) // Subscribe to changes to the result of multiplyClicks(20)

reactor.set(clickCountAtom, 15) // Output: "Changed to 300"

unsubscribe() // Unsubscribe to changes to the result of multiplyClicks(20)

reactor.set(clickCountAtom, 16) // No output
```

## React

In React, the `useEval` hook subscribes an element to a function call result within a Reactor. Here is a button that increases the click count. Each time it is clicked, `clickCountAtom`'s value is incremented in `reactor`. React is then notified about the possible changes to the results of `value(clickCountAtom)` and `multiplyClicks(4)` so it knows to rerender the `ClickCounter` button.

```jsx
import { useEval } from 'tritiumdb'

function ClickCounter() {
  const numClicks = useEval(reactor, value, clickCountAtom)
  const quadrupleNumClicks = useEval(reactor, multiplyClicks, 4)

  return (
    <button onClick={() => {
      reactor.modify(clickCountAtom, count => count + 1)
    }}>
      Clicks: {numClicks}; Quadruple clicks: {quadrupleNumClicks}
    </button>
  )
}
```
