// @aiUnreviewed
// @vitest-environment jsdom

import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Atom, value } from './atom'
import { emptyDatabase, type Database } from './database'
import { expr, type Expression } from './expression'
import { memoize } from './memoize'
import { Reactor } from './reactor'
import { useEval, useEvalExpr } from './reactor_hooks'

// Observe lifecycle behavior without replacing real evaluation or subscriptions.
class TrackingReactor extends Reactor {
  readonly subscriptions = new Map<() => void, Expression>()
  notifications = 0

  override watchExpr<A extends any[], R>(callback: () => void, expression: Expression<A, R>): () => void {
    const notify = () => {
      this.notifications++
      callback()
    }
    const unsubscribe = super.watchExpr(notify, expression)
    this.subscriptions.set(notify, expression)
    return () => {
      this.subscriptions.delete(notify)
      unsubscribe()
    }
  }
}

function useExpression<A extends any[], R>(reactor: Reactor, pred: (...args: A) => R, ...args: A): R {
  return useEvalExpr(reactor, expr(pred, ...args))
}

describe.each([
  ['useEval', useEval],
  ['useEvalExpr', useExpression],
] as const)('%s', (_name, useSelector) => {
  let container: HTMLDivElement
  let root: Root
  let reactors: TrackingReactor[]

  function createReactor(initialDb?: Database): TrackingReactor {
    const reactor = new TrackingReactor(initialDb)
    reactors.push(reactor)
    return reactor
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    reactors = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    for (const reactor of reactors) {
      expect(reactor.subscriptions.size).toBe(0)
    }
  })

  it('memoizes object-valued snapshots across reads and renders despite uncached evaluation', () => {
    const reactor = createReactor()
    const count = new Atom(2)
    const select = vi.fn((factor: number) => ({ count: value(count) * factor }))
    expect(reactor.eval(select, 3)).not.toBe(reactor.eval(select, 3))
    select.mockClear()

    let latest!: { count: number }
    function Reader() {
      latest = useSelector(reactor, select, 3)
      return String(latest.count)
    }

    act(() => root.render(createElement(Reader)))
    const firstResult = latest
    expect(firstResult).toEqual({ count: 6 })
    expect(container.textContent).toBe('6')

    act(() => root.render(createElement(Reader)))
    expect(latest).toBe(firstResult)
    expect(select).toHaveBeenCalledExactlyOnceWith(3)
    expect(reactor.subscriptions.size).toBe(1)
    const [subscription] = reactor.subscriptions.values()
    expect(subscription.equals(expr(memoize(select), 3))).toBe(true)
  })

  it('updates repeatedly for dependency changes but reuses results after unrelated changes', () => {
    const reactor = createReactor()
    const count = new Atom(1)
    const unrelated = new Atom(0)
    const select = vi.fn(() => ({ count: value(count) }))
    let latest!: { count: number }
    const Reader = vi.fn(() => {
      latest = useSelector(reactor, select)
      return String(latest.count)
    })

    act(() => root.render(createElement(Reader)))
    const firstResult = latest
    const initialRenders = Reader.mock.calls.length

    act(() => reactor.set(unrelated, 10))
    expect(Reader).toHaveBeenCalledTimes(initialRenders)
    expect(reactor.notifications).toBe(0)
    act(() => root.render(createElement(Reader)))
    expect(latest).toBe(firstResult)
    expect(select).toHaveBeenCalledTimes(1)

    act(() => reactor.set(count, 2))
    expect(latest).toEqual({ count: 2 })
    expect(latest).not.toBe(firstResult)
    act(() => reactor.set(count, 3))
    expect(latest).toEqual({ count: 3 })
    expect(container.textContent).toBe('3')
    expect(firstResult).toEqual({ count: 1 })
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('checks invalidated primitive snapshots without rerendering when the selected value is unchanged', () => {
    const reactor = createReactor()
    const count = new Atom(0)
    const select = vi.fn(() => value(count) % 2)
    const Reader = vi.fn(() => String(useSelector(reactor, select)))

    act(() => root.render(createElement(Reader)))
    const initialRenders = Reader.mock.calls.length
    act(() => reactor.set(count, 2))
    expect(select).toHaveBeenCalledTimes(2)
    expect(Reader).toHaveBeenCalledTimes(initialRenders)
    expect(container.textContent).toBe('0')

    act(() => reactor.set(count, 3))
    expect(container.textContent).toBe('1')
    expect(Reader.mock.calls.length).toBeGreaterThan(initialRenders)
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('switches arguments and predicates without keeping stale subscriptions', () => {
    const reactor = createReactor()
    const left = new Atom(1)
    const right = new Atom(10)
    const select = vi.fn((atom: Atom<number>, factor: number) => ({ count: value(atom) * factor }))
    const otherSelect = vi.fn((atom: Atom<number>, factor: number) => ({ count: value(atom) * factor + 100 }))
    let latest!: { count: number }
    function Reader({ atom, factor, pred }: {
      atom: Atom<number>
      factor: number
      pred: (atom: Atom<number>, factor: number) => { count: number }
    }) {
      latest = useSelector(reactor, pred, atom, factor)
      return String(latest.count)
    }
    function render(atom: Atom<number>, factor: number, pred = select) {
      act(() => root.render(createElement(Reader, { atom, factor, pred })))
      expect(reactor.subscriptions.size).toBe(1)
    }

    render(left, 2)
    expect(latest).toEqual({ count: 2 })
    render(left, 3)
    expect(latest).toEqual({ count: 3 })
    render(right, 3)
    expect(latest).toEqual({ count: 30 })
    const rightResult = latest

    act(() => reactor.set(left, 2))
    expect(latest).toBe(rightResult)
    expect(reactor.notifications).toBe(0)
    expect(select).toHaveBeenCalledTimes(3)

    act(() => reactor.set(right, 20))
    expect(latest).toEqual({ count: 60 })
    render(right, 3, otherSelect)
    expect(latest).toEqual({ count: 160 })
    act(() => reactor.set(right, 30))
    expect(latest).toEqual({ count: 190 })
    expect(reactor.notifications).toBe(2)
    expect(select).toHaveBeenCalledTimes(4)
    expect(otherSelect).toHaveBeenCalledTimes(2)
  })

  it('switches reactors without sharing snapshots or retaining the old subscription', () => {
    const count = new Atom(0)
    const first = createReactor(emptyDatabase.with(count, 1))
    const second = createReactor(emptyDatabase.with(count, 2))
    const select = vi.fn(() => ({ count: value(count) }))
    let latest!: { count: number }
    const Reader = vi.fn(({ reactor }: { reactor: Reactor }) => {
      latest = useSelector(reactor, select)
      return String(latest.count)
    })

    act(() => root.render(createElement(Reader, { reactor: first })))
    const firstResult = latest
    act(() => root.render(createElement(Reader, { reactor: second })))
    expect(latest).toEqual({ count: 2 })
    expect(latest).not.toBe(firstResult)
    expect(first.subscriptions.size).toBe(0)
    expect(second.subscriptions.size).toBe(1)
    const secondResult = latest
    const renders = Reader.mock.calls.length

    act(() => first.set(count, 10))
    expect(first.notifications).toBe(0)
    expect(latest).toBe(secondResult)
    expect(Reader).toHaveBeenCalledTimes(renders)
    act(() => second.set(count, 20))
    expect(latest).toEqual({ count: 20 })
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('uses already-memoized predicates unchanged and tracks cached reads', () => {
    const reactor = createReactor()
    const count = new Atom(1)
    const original = vi.fn(() => ({ count: value(count) }))
    const select = memoize(original)
    const cached = reactor.eval(select)
    let latest!: { count: number }
    function Reader() {
      latest = useSelector(reactor, select)
      return String(latest.count)
    }

    act(() => root.render(createElement(Reader)))
    expect(latest).toBe(cached)
    const [subscription] = reactor.subscriptions.values()
    expect(subscription.pred).toBe(select)
    expect(original).toHaveBeenCalledTimes(1)
    act(() => reactor.set(count, 2))
    expect(latest).toEqual({ count: 2 })
    expect(original).toHaveBeenCalledTimes(2)
  })

  it('observes only the completed state of a batch update', () => {
    const reactor = createReactor()
    const left = new Atom(1)
    const right = new Atom(2)
    const select = vi.fn(() => [value(left), value(right)] as const)
    const snapshots: Array<readonly [number, number]> = []
    function Reader() {
      const snapshot = useSelector(reactor, select)
      snapshots.push(snapshot)
      return snapshot.join(',')
    }

    act(() => root.render(createElement(Reader)))
    act(() => reactor.setMany([left, 10], [right, 20]))
    expect(container.textContent).toBe('10,20')
    expect(snapshots).toContainEqual([1, 2])
    expect(snapshots).toContainEqual([10, 20])
    expect(snapshots).not.toContainEqual([10, 2])
    expect(snapshots).not.toContainEqual([1, 20])
    expect(select).toHaveBeenCalledTimes(2)
    expect(reactor.notifications).toBe(1)
  })

  it('refreshes conditional dependencies after a tracked branch changes', () => {
    const reactor = createReactor()
    const useLeft = new Atom(true)
    const left = new Atom(1)
    const right = new Atom(10)
    const select = vi.fn(() => ({ count: value(useLeft) ? value(left) : value(right) }))
    function Reader() {
      return String(useSelector(reactor, select).count)
    }

    act(() => root.render(createElement(Reader)))
    expect(container.textContent).toBe('1')
    act(() => reactor.set(useLeft, false))
    expect(container.textContent).toBe('10')
    act(() => reactor.set(left, 2))
    expect(reactor.notifications).toBe(1)
    expect(select).toHaveBeenCalledTimes(2)
    act(() => reactor.set(right, 20))
    expect(container.textContent).toBe('20')
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('catches a store change between rendering and subscription', () => {
    const reactor = createReactor()
    const count = new Atom(1)
    const select = vi.fn(() => ({ count: value(count) }))
    const subscribe = reactor.watchExpr.bind(reactor)
    let changed = false
    vi.spyOn(reactor, 'watchExpr').mockImplementation((callback, expression) => {
      if (!changed) {
        changed = true
        reactor.set(count, 2)
      }
      return subscribe(callback, expression)
    })
    function Reader() {
      return String(useSelector(reactor, select).count)
    }

    act(() => root.render(createElement(Reader)))
    expect(container.textContent).toBe('2')
    expect(select).toHaveBeenCalledTimes(2)
    act(() => reactor.set(count, 3))
    expect(container.textContent).toBe('3')
  })

  it('supports multiple StrictMode consumers and cleans up on removal and unmount', () => {
    const reactor = createReactor()
    const count = new Atom(1)
    const select = vi.fn(() => ({ count: value(count) }))
    function Reader({ id }: { id: string }) {
      return createElement('span', null, `${id}:${useSelector(reactor, select).count}`)
    }
    function render(showFirst: boolean) {
      act(() => root.render(createElement(StrictMode, null,
        showFirst ? createElement(Reader, { key: 'first', id: 'first' }) : null,
        createElement(Reader, { key: 'second', id: 'second' }),
      )))
    }

    render(true)
    expect(container.textContent).toBe('first:1second:1')
    expect(reactor.subscriptions.size).toBe(2)
    expect(select).toHaveBeenCalledTimes(1)
    render(false)
    expect(reactor.subscriptions.size).toBe(1)
    act(() => reactor.set(count, 2))
    expect(container.textContent).toBe('second:2')
    expect(reactor.notifications).toBe(1)
    expect(select).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
    expect(reactor.subscriptions.size).toBe(0)
    act(() => reactor.set(count, 3))
    expect(reactor.notifications).toBe(1)
    expect(select).toHaveBeenCalledTimes(2)
  })
})
