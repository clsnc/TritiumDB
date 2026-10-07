import { describe, it, expect, vi } from 'vitest';
import { Reactor } from './reactor';
import { expr } from './expression';
import { spy } from './database';
import { Atom, value } from './atom';

describe('DatabaseReactor', () => {
    it('getResult returns set value', () => {
        const reactor = new Reactor();
        const atom = new Atom('');
        reactor.set(atom, 'result');
        const res = reactor.getResult(expr(value, atom));
        expect(res).toBe('result');
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
        const depFunc = (_arg: string) => spy(expr(value, base)) + 1;
        // Set up base value and create dependency
        reactor.set(base, 10);
        expect(reactor.getResult(expr(depFunc, 'key'))).toBe(11);
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
        expect(reactor.getResult(expr(depFunc, 'key'))).toBe(31);
        // Third change after recompute: should notify again
        reactor.set(base, 40);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('subscribe computes dependent expression for notifications', () => {
        const reactor = new Reactor();
        const base = new Atom(0);
        const callback = vi.fn();
        const depFunc = (_arg: string) => spy(expr(value, base)) + 1;

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
