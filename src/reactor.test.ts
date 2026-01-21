import { describe, it, expect, vi } from 'vitest';
import { Reactor } from './reactor';
import { Database } from './database';

describe('DatabaseReactor', () => {
    it('getResult returns set value', () => {
        const reactor = new Reactor();
        reactor.set(['pred', 'arg'], 'result');
        const res = reactor.getResult(['pred', 'arg']);
        expect(res).toBe('result');
    });

    it('set notifies subscribers for affected expression', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const expr = ['pred', 'arg1'];
        reactor.subscribe(expr, callback);
        reactor.set(['pred', 'arg1'], 'result');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('set does not notify for unaffected expression', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        reactor.subscribe(['pred', 'arg1'], callback);
        reactor.set(['other', 'arg'], 'res');
        reactor.flushNotifications();
        expect(callback).not.toHaveBeenCalled();
    });

    it('multiple subscribers to same expression', () => {
        const reactor = new Reactor();
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const expr = ['pred', 'arg'];
        reactor.subscribe(expr, cb1);
        reactor.subscribe(expr, cb2);
        reactor.set(['pred', 'arg'], 'res');
        reactor.flushNotifications();
        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe works', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const expr = ['pred', 'arg'];
        const unsubscribe = reactor.subscribe(expr, callback);
        reactor.set(['pred', 'arg'], 'res');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        unsubscribe();
        reactor.set(['pred', 'arg'], 'res2');
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('handles dependent expression notifications: notifies on change, skips duplicates without recompute, resumes after recompute', () => {
        const reactor = new Reactor();
        const depFunc = (db: Database, arg) => db.spyResult(['base', arg]) + 1;
        // Set up base value and create dependency
        reactor.set(['base', 'key'], 10);
        expect(reactor.getResult([depFunc, 'key'])).toBe(11);
        // Subscribe to dependent expression
        const callback = vi.fn();
        reactor.subscribe([depFunc, 'key'], callback);
        // First change: should notify
        reactor.set(['base', 'key'], 20);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        // Second change without recompute: should not notify
        reactor.set(['base', 'key'], 30);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
        // Recompute dependent
        expect(reactor.getResult([depFunc, 'key'])).toBe(31);
        // Third change after recompute: should notify again
        reactor.set(['base', 'key'], 40);
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('callbacks are not called until flushNotifications', () => {
        const reactor = new Reactor();
        const callback = vi.fn();
        const expr = ['pred', 'arg'];
        reactor.subscribe(expr, callback);
        reactor.set(['pred', 'arg'], 'value');
        expect(callback).not.toHaveBeenCalled();
        reactor.flushNotifications();
        expect(callback).toHaveBeenCalledTimes(1);
    });
});