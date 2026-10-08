import { describe, it, expect, vi } from 'vitest';
import { Reactor } from './reactor';
import { expr } from './expression';
import { spy } from './spy';
import { Atom, value } from './atom';

describe('DatabaseReactor', () => {
    it('getExprResult returns set value', () => {
        const reactor = new Reactor();
        const atom = new Atom('');
        reactor.set(atom, 'result');
        const res = reactor.getExprResult(expr(value, atom));
        expect(res).toBe('result');
    });

    it('eval accepts a function with no arguments', () => {
        const reactor = new Reactor();

        expect(reactor.eval(() => 'result')).toBe('result');
    });

    it('eval delegates to getExprResult and shares its cache', () => {
        const reactor = new Reactor();
        const func = vi.fn((label: string, count: number) => `${label}-${count}`);
        const getExprResult = vi.spyOn(reactor, 'getExprResult');

        const result: string = reactor.eval(func, 'test', 2);
        expect(result).toBe('test-2');
        expect(getExprResult).toHaveBeenCalledWith(expr(func, 'test', 2));
        expect(reactor.getExprResult(expr(func, 'test', 2))).toBe(result);
        expect(reactor.eval(func, 'test', 2)).toBe(result);
        expect(func).toHaveBeenCalledExactlyOnceWith('test', 2);
    });

    it('eval tracks dependencies and recomputes after set', () => {
        const reactor = new Reactor();
        const base = new Atom(1);
        const func = vi.fn((factor: number) => spy(value, base) * factor);

        expect(reactor.eval(func, 3)).toBe(3);
        reactor.set(base, 2);
        expect(reactor.eval(func, 3)).toBe(6);
        expect(func).toHaveBeenCalledTimes(2);
    });

    it('eval propagates and caches errors', () => {
        const reactor = new Reactor();
        const error = new Error('boom');
        const func = vi.fn(() => { throw error });

        expect(() => reactor.eval(func)).toThrow(error);
        expect(() => reactor.eval(func)).toThrow(error);
        expect(func).toHaveBeenCalledTimes(1);
    });

    it('set notifies subscribers for affected expression', () => {
        const reactor = new Reactor();
        const atom = new Atom('');
        const callback = vi.fn();
        const e = expr(value, atom);
        reactor.subscribe(e, callback);
        reactor.set(atom, 'result');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('set does not notify for unaffected expression', () => {
        const reactor = new Reactor();
        const atom = new Atom('');
        const other = new Atom('');
        const callback = vi.fn();
        reactor.subscribe(expr(value, atom), callback);
        reactor.set(other, 'res');
        reactor.flushNotifications();
        expect(callback).not.toHaveBeenCalled();
    });

    it('multiple subscribers to same expression', () => {
        const reactor = new Reactor();
        const atom = new Atom('');
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const e = expr(value, atom);
        reactor.subscribe(e, cb1);
        reactor.subscribe(e, cb2);
        reactor.set(atom, 'res');
        reactor.flushNotifications();
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe works', () => {
        const reactor = new Reactor();
        const atom = new Atom('');
        const callback = vi.fn();
        const e = expr(value, atom);
        const unsubscribe = reactor.subscribe(e, callback);
        reactor.set(atom, 'res');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        unsubscribe();
        reactor.set(atom, 'res2');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('handles dependent expression notifications: notifies on change, skips duplicates without recompute, resumes after recompute', () => {
        const reactor = new Reactor();
        const base = new Atom(0);
        const depFunc = (_arg: string) => spy(value, base) + 1;
        // Set up base value and create dependency
        reactor.set(base, 10);
        expect(reactor.getExprResult(expr(depFunc, 'key'))).toBe(11);
        // Subscribe to dependent expression
        const callback = vi.fn();
        reactor.subscribe(expr(depFunc, 'key'), callback);
        // First change: should notify
        reactor.set(base, 20);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        // Second change without recompute: should not notify
        reactor.set(base, 30);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        // Recompute dependent
        expect(reactor.getExprResult(expr(depFunc, 'key'))).toBe(31);
        // Third change after recompute: should notify again
        reactor.set(base, 40);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('subscribe computes dependent expression for notifications', () => {
        const reactor = new Reactor();
        const base = new Atom(0);
        const callback = vi.fn();
        const depFunc = (_arg: string) => spy(value, base) + 1;

        reactor.set(base, 10);
        reactor.subscribe(expr(depFunc, 'key'), callback);

        reactor.set(base, 20);
        reactor.flushNotifications();

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('callbacks are not called until flushNotifications', () => {
        const reactor = new Reactor();
        const atom = new Atom('');
        const callback = vi.fn();
        const e = expr(value, atom);
        reactor.subscribe(e, callback);
        reactor.set(atom, 'value');
        expect(callback).not.toHaveBeenCalled();
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not double-notify when the same expression is set multiple times before flushing', () => {
        const reactor = new Reactor();
        const a = new Atom(0);
        const callback = vi.fn();
        reactor.subscribe(expr(value, a), callback);
        reactor.set(a, 1);
        reactor.set(a, 2);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });
});
