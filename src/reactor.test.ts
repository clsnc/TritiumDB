// @aiUnreviewed

import { describe, it, expect, vi } from 'vitest';
import { Reactor } from './reactor';
import { expr } from './expression';
import { atom as createAtom } from './atom';
import { memoize } from './memoize';

describe('DatabaseReactor', () => {
    describe('setMany', () => {
        it('sets multiple values immediately', () => {
            const reactor = new Reactor();
            const count = createAtom(0);
            const name = createAtom('before');

            reactor.setMany([count, 10], [name, 'after']);
            expect(reactor.eval(count)).toBe(10);
            expect(reactor.eval(name)).toBe('after');
        });

        it('notifies a shared dependent once with the completed state', () => {
            const reactor = new Reactor();
            const a = createAtom(1);
            const b = createAtom(2);
            const sum = () => a() + b();
            const callback = vi.fn(() => reactor.eval(sum));
            reactor.watch(callback, sum);

            reactor.setMany([a, 10], [b, 20]);

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback.mock.results[0].value).toBe(30);
        });

        it('notifies for single and batch updates but not empty updates', () => {
            const reactor = new Reactor();
            const before = createAtom(0);
            const batch = createAtom(0);
            const beforeCallback = vi.fn();
            const batchCallback = vi.fn();
            reactor.watch(beforeCallback, before);
            reactor.watch(batchCallback, batch);

            reactor.set(before, 1);
            expect(beforeCallback).toHaveBeenCalledTimes(1);
            expect(batchCallback).not.toHaveBeenCalled();

            reactor.setMany([batch, 2]);
            expect(beforeCallback).toHaveBeenCalledTimes(1);
            expect(batchCallback).toHaveBeenCalledTimes(1);

            reactor.setMany();
            expect(beforeCallback).toHaveBeenCalledTimes(1);
            expect(batchCallback).toHaveBeenCalledTimes(1);
        });
    });

    it('evalExpr returns set value', () => {
        const reactor = new Reactor();
        const atom = createAtom('');
        reactor.set(atom, 'result');
        const res = reactor.evalExpr(expr(atom));
        expect(res).toBe('result');
    });

    it('eval accepts a function with no arguments', () => {
        const reactor = new Reactor();

        expect(reactor.eval(() => 'result')).toBe('result');
    });

    it('eval delegates to evalExpr and executes on every call', () => {
        const reactor = new Reactor();
        const func = vi.fn((label: string, count: number) => `${label}-${count}`);
        const evalExpr = vi.spyOn(reactor, 'evalExpr');

        const result: string = reactor.eval(func, 'test', 2);
        expect(result).toBe('test-2');
        expect(evalExpr).toHaveBeenCalledWith(expr(func, 'test', 2));
        expect(reactor.evalExpr(expr(func, 'test', 2))).toBe(result);
        expect(reactor.eval(func, 'test', 2)).toBe(result);
        expect(func).toHaveBeenCalledTimes(3);
        expect(func).toHaveBeenNthCalledWith(1, 'test', 2);
        expect(func).toHaveBeenNthCalledWith(2, 'test', 2);
        expect(func).toHaveBeenNthCalledWith(3, 'test', 2);
    });

    it('eval tracks dependencies and recomputes after set', () => {
        const reactor = new Reactor();
        const base = createAtom(1);
        const func = vi.fn((factor: number) => base() * factor);

        expect(reactor.eval(func, 3)).toBe(3);
        reactor.set(base, 2);
        expect(reactor.eval(func, 3)).toBe(6);
        expect(func).toHaveBeenCalledTimes(2);
    });

    it('eval and evalExpr propagate errors without caching them', () => {
        const reactor = new Reactor();
        const error = new Error('boom');
        const func = vi.fn(() => { throw error });

        expect(() => reactor.eval(func)).toThrow(error);
        expect(() => reactor.evalExpr(expr(func))).toThrow(error);
        expect(() => reactor.eval(func)).toThrow(error);
        expect(func).toHaveBeenCalledTimes(3);
    });

    it('watches direct value reads and reevaluates them after updates', () => {
        const reactor = new Reactor();
        const atom = createAtom(1);
        const other = createAtom(0);
        const read = () => atom() * 2;
        const callback = vi.fn(() => reactor.eval(read));
        const unsubscribe = reactor.watch(callback, read);

        reactor.set(other, 10);
        expect(callback).not.toHaveBeenCalled();

        reactor.set(atom, 3);
        reactor.set(atom, 4);
        expect(callback.mock.results.map(result => result.value)).toEqual([6, 8]);

        unsubscribe();
        reactor.set(atom, 5);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('watchExpr tracks memoized cache hits and rearms after reevaluation', () => {
        const reactor = new Reactor();
        const count = createAtom(1);
        const original = vi.fn(() => count() * 2);
        const read = memoize(original);
        expect(reactor.eval(read)).toBe(2);

        const callback = vi.fn(() => reactor.evalExpr(expr(read)));
        const unsubscribe = reactor.watchExpr(callback, expr(read));
        expect(original).toHaveBeenCalledTimes(1);

        reactor.set(count, 2);
        reactor.set(count, 3);
        expect(callback.mock.results.map(result => result.value)).toEqual([4, 6]);
        expect(original).toHaveBeenCalledTimes(3);

        unsubscribe();
        reactor.set(count, 4);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('watch accepts a function with no arguments', () => {
        const reactor = new Reactor();
        const base = createAtom(1);
        const callback = vi.fn();
        const func = () => base() + 1;

        reactor.watch(callback, func);
        expect(callback).not.toHaveBeenCalled();
        reactor.set(base, 2);

        expect(callback).toHaveBeenCalledExactlyOnceWith();
        expect(reactor.eval(func)).toBe(3);
    });

    it('watch tracks dependencies, notifies synchronously, and supports unsubscribing', () => {
        const reactor = new Reactor();
        const base = createAtom(1);
        const other = createAtom(0);
        const callback = vi.fn();
        const func = (factor: number) => base() * factor;
        const unsubscribe = reactor.watch(callback, func, 3);

        reactor.set(other, 1);
        expect(callback).not.toHaveBeenCalled();

        reactor.set(base, 2);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(reactor.eval(func, 3)).toBe(6);

        unsubscribe();
        reactor.set(base, 3);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('set does not notify for unaffected expression', () => {
        const reactor = new Reactor();
        const atom = createAtom('');
        const other = createAtom('');
        const callback = vi.fn();
        reactor.watchExpr(callback, expr(atom));
        reactor.set(other, 'res');
        expect(callback).not.toHaveBeenCalled();
    });

    it('multiple subscribers to same expression', () => {
        const reactor = new Reactor();
        const atom = createAtom('');
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const e = expr(atom);
        reactor.watchExpr(cb1, e);
        reactor.watchExpr(cb2, e);
        reactor.set(atom, 'res');
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe works', () => {
        const reactor = new Reactor();
        const atom = createAtom('');
        const callback = vi.fn();
        const e = expr(atom);
        const unsubscribe = reactor.watchExpr(callback, e);
        reactor.set(atom, 'res');
        expect(callback).toHaveBeenCalledTimes(1);
        unsubscribe();
        reactor.set(atom, 'res2');
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('handles dependent expression notifications: notifies on change, skips duplicates without recompute, resumes after recompute', () => {
        const reactor = new Reactor();
        const base = createAtom(0);
        const depFunc = (_arg: string) => base() + 1;
        // Set up base value and create dependency
        reactor.set(base, 10);
        expect(reactor.eval(depFunc, 'key')).toBe(11);
        // Subscribe to dependent expression
        const callback = vi.fn();
        reactor.watchExpr(callback, expr(depFunc, 'key'));
        // First change: should notify
        reactor.set(base, 20);
        expect(callback).toHaveBeenCalledTimes(1);
        // Second change without recompute: should not notify
        reactor.set(base, 30);
        expect(callback).toHaveBeenCalledTimes(1);
        // Recompute dependent
        expect(reactor.eval(depFunc, 'key')).toBe(31);
        // Third change after recompute: should notify again
        reactor.set(base, 40);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('watchExpr computes dependent expression for notifications', () => {
        const reactor = new Reactor();
        const base = createAtom(0);
        const callback = vi.fn();
        const depFunc = (_arg: string) => base() + 1;

        reactor.set(base, 10);
        reactor.watchExpr(callback, expr(depFunc, 'key'));

        reactor.set(base, 20);

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not repeat notifications when a callback makes another change', () => {
        const reactor = new Reactor();
        const atom = createAtom(0);
        const other = createAtom(0);
        const callback = vi.fn(() => reactor.set(other, 1));
        const otherCallback = vi.fn();
        const nestedCallback = vi.fn();
        reactor.watch(callback, atom);
        reactor.watch(otherCallback, atom);
        reactor.watch(nestedCallback, other);

        reactor.set(atom, 1);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(otherCallback).toHaveBeenCalledTimes(1);
        expect(nestedCallback).toHaveBeenCalledTimes(1);
    });

    it('notifies synchronously for updates made inside a callback', () => {
        const reactor = new Reactor();
        const atom = createAtom(0);
        const other = createAtom(0);
        const otherCallback = vi.fn(() => reactor.eval(other));
        const callback = vi.fn(() => {
            reactor.set(other, 1);
            expect(otherCallback).toHaveBeenCalledTimes(1);
        });
        reactor.watch(callback, atom);
        reactor.watch(otherCallback, other);

        reactor.set(atom, 1);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(otherCallback).toHaveBeenCalledTimes(1);
        expect(otherCallback.mock.results[0].value).toBe(1);
    });

    it('notifies separately for consecutive sets when the subscription reevaluates', () => {
        const reactor = new Reactor();
        const a = createAtom(0);
        const callback = vi.fn(() => reactor.eval(a));
        reactor.watchExpr(callback, expr(a));
        reactor.set(a, 1);
        expect(callback).toHaveBeenCalledTimes(1);
        reactor.set(a, 2);
        expect(callback).toHaveBeenCalledTimes(2);
    });
});
