import { describe, it, expect, vi } from 'vitest';
import { Reactor } from './reactor';
import { Database, expr } from './database';

describe('DatabaseReactor', () => {
    it('getResult returns set value', () => {
        const reactor = new Reactor();
        reactor.set(expr('pred', 'arg'), 'result');
        const res = reactor.getResult(expr('pred', 'arg'));
        expect(res).toBe('result');
    });

    it('set notifies subscribers for affected expression', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const e = expr('pred', 'arg1');
        reactor.subscribe(e, callback);
        reactor.set(expr('pred', 'arg1'), 'result');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('setError stores an error and notifies subscribers', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const e = expr('pred', 'arg1');
        const err = new Error('boom');
        reactor.subscribe(e, callback);

        reactor.setError(e, err);
        reactor.flushNotifications();

        expect(() => reactor.getResult(e)).toThrow(err);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('set does not notify for unaffected expression', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        reactor.subscribe(expr('pred', 'arg1'), callback);
        reactor.set(expr('other', 'arg'), 'res');
        reactor.flushNotifications();
        expect(callback).not.toHaveBeenCalled();
    });

    it('multiple subscribers to same expression', () => {
        const reactor = new Reactor();
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const e = expr('pred', 'arg');
        reactor.subscribe(e, cb1);
        reactor.subscribe(e, cb2);
        reactor.set(expr('pred', 'arg'), 'res');
        reactor.flushNotifications();
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe works', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const e = expr('pred', 'arg');
        const unsubscribe = reactor.subscribe(e, callback);
        reactor.set(expr('pred', 'arg'), 'res');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        unsubscribe();
        reactor.set(expr('pred', 'arg'), 'res2');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('handles dependent expression notifications: notifies on change, skips duplicates without recompute, resumes after recompute', () => {
        const reactor = new Reactor();
        const depFunc = (db: Database, arg) => db.spyResult(expr('base', arg)) + 1;
        // Set up base value and create dependency
        reactor.set(expr('base', 'key'), 10);
        expect(reactor.getResult(expr(depFunc, 'key'))).toBe(11);
        // Subscribe to dependent expression
        const callback = vi.fn();
        reactor.subscribe(expr(depFunc, 'key'), callback);
        // First change: should notify
        reactor.set(expr('base', 'key'), 20);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        // Second change without recompute: should not notify
        reactor.set(expr('base', 'key'), 30);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        // Recompute dependent
        expect(reactor.getResult(expr(depFunc, 'key'))).toBe(31);
        // Third change after recompute: should notify again
        reactor.set(expr('base', 'key'), 40);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('subscribe computes dependent expression for notifications', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const depFunc = (db: Database, arg) => db.spyResult(expr('base', arg)) + 1;

        reactor.set(expr('base', 'key'), 10);
        reactor.subscribe(expr(depFunc, 'key'), callback);

        reactor.set(expr('base', 'key'), 20);
        reactor.flushNotifications();

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('callbacks are not called until flushNotifications', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const e = expr('pred', 'arg');
        reactor.subscribe(e, callback);
        reactor.set(expr('pred', 'arg'), 'value');
        expect(callback).not.toHaveBeenCalled();
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });
});