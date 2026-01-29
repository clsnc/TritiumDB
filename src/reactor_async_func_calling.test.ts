import { describe, it, expect, vi } from 'vitest';
import { Database } from './database';
import { Reactor } from './reactor';
import {
  ASYNC_CALL_RESULT_INTERNAL_PRED,
  ASYNC_CALL_STATUS_INTERNAL_PRED,
  asyncCallResult,
  AsyncCallStatus,
  asyncCallStatus,
  AsyncCallIncompleteError,
  resultIsReady,
} from './async';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('Reactor async function calling', () => {
  it('tracks status and result for async calls', async () => {
    const reactor = new Reactor();
    const deferred = createDeferred<string>();
    const asyncFunc = vi.fn((value: string) => deferred.promise);

    expect(reactor.getResult([asyncCallStatus, asyncFunc, 'arg'])).toBe(AsyncCallStatus.NotStarted);
    expect(reactor.getResult([asyncCallResult, asyncFunc, 'arg'])).toBeUndefined();

    reactor.ensureAsyncRun(asyncFunc, 'arg');
    reactor.ensureAsyncRun(asyncFunc, 'arg');

    expect(asyncFunc).toHaveBeenCalledTimes(1);
    expect(reactor.getResult([asyncCallStatus, asyncFunc, 'arg'])).toBe(AsyncCallStatus.Executing);
    expect(reactor.getResult([asyncCallResult, asyncFunc, 'arg'])).toBeUndefined();

    deferred.resolve('result');
    await deferred.promise;
    await Promise.resolve();

    expect(reactor.getResult([asyncCallStatus, asyncFunc, 'arg'])).toBe(AsyncCallStatus.Complete);
    expect(reactor.getResult([asyncCallResult, asyncFunc, 'arg'])).toBe('result');
  });

  it('notifies subscribers when async status and result change', async () => {
    const reactor = new Reactor();
    const deferred = createDeferred<number>();
    const asyncFunc = vi.fn(() => deferred.promise);

    const statusCallback = vi.fn();
    const resultCallback = vi.fn();
    reactor.subscribe([asyncCallStatus, asyncFunc], statusCallback);
    reactor.subscribe([asyncCallResult, asyncFunc], resultCallback);

    reactor.ensureAsyncRun(asyncFunc);
    reactor.flushNotifications();

    expect(statusCallback).toHaveBeenCalledTimes(1);
    expect(resultCallback).not.toHaveBeenCalled();
    expect(reactor.getResult([asyncCallStatus, asyncFunc])).toBe(AsyncCallStatus.Executing);

    deferred.resolve(42);
    await deferred.promise;
    await Promise.resolve();

    reactor.flushNotifications();

    expect(statusCallback).toHaveBeenCalledTimes(2);
    expect(resultCallback).toHaveBeenCalledTimes(1);
    expect(reactor.getResult([asyncCallStatus, asyncFunc])).toBe(AsyncCallStatus.Complete);
    expect(reactor.getResult([asyncCallResult, asyncFunc])).toBe(42);
  });

  it('spyAsyncEffectResult throws until async result is ready', () => {
    const db = new Database();
    const asyncFunc = vi.fn(async (value: string) => `value-${value}`);

    const effectResultExpr = [ASYNC_CALL_RESULT_INTERNAL_PRED, asyncFunc, 'alpha'];
    const effectStatusExpr = [ASYNC_CALL_STATUS_INTERNAL_PRED, asyncFunc, 'alpha'];
    const outerExpr = [(db: Database) => db.spyAsyncEffectResult([asyncFunc, 'alpha'])];

    let thrownError;
    try {
      db.getResult(outerExpr);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(AsyncCallIncompleteError);

    const readyDb = db
      .with(effectResultExpr, 'resolved')
      .with(effectStatusExpr, AsyncCallStatus.Complete);

    const result = readyDb.getResult(outerExpr);
    expect(result).toBe('resolved');
  });

  it('resultIsReady reflects readiness through nested dependencies', () => {
    const db = new Database();
    const asyncFunc = vi.fn(async (value: string) => `value-${value}`);

    const effectResultExpr = [ASYNC_CALL_RESULT_INTERNAL_PRED, asyncFunc, 'beta'];
    const effectStatusExpr = [ASYNC_CALL_STATUS_INTERNAL_PRED, asyncFunc, 'beta'];

    const inner = (db: Database) => db.spyAsyncEffectResult([asyncFunc, 'beta']);
    const outer = (db: Database) => `outer-${db.spyResult([inner])}`;

    expect(db.getResult([resultIsReady, outer])).toBe(false);

    const readyDb = db
      .with(effectResultExpr, 'resolved')
      .with(effectStatusExpr, AsyncCallStatus.Complete);

    expect(readyDb.getResult([resultIsReady, outer])).toBe(true);
    expect(readyDb.getResult([outer])).toBe('outer-resolved');
  });

  it('resultIsReady works with Reactor async calls', async () => {
    const reactor = new Reactor();
    const deferred = createDeferred<string>();
    const asyncFunc = vi.fn((value: string) => deferred.promise);

    const inner = (db: Database) => db.spyAsyncEffectResult([asyncFunc, 'gamma']);
    const outer = (db: Database) => `outer-${db.spyResult([inner])}`;

    expect(reactor.getResult([resultIsReady, outer])).toBe(false);

    reactor.ensureAsyncRun(asyncFunc, 'gamma');

    expect(reactor.getResult([resultIsReady, outer])).toBe(false);

    deferred.resolve('done');
    await deferred.promise;
    await Promise.resolve();

    expect(reactor.getResult([resultIsReady, outer])).toBe(true);
    expect(reactor.getResult([outer])).toBe('outer-done');
  });

  it('getResultPromise resolves immediately for sync values', async () => {
    const reactor = new Reactor();
    reactor.set(['sync', 'key'], 'value');

    const result = await reactor.getResultPromise(['sync', 'key']);
    expect(result).toBe('value');
  });

  it('getResultPromise waits for async dependencies', async () => {
    const reactor = new Reactor();
    const deferred = createDeferred<string>();
    const asyncFunc = vi.fn((value: string) => deferred.promise);

    const inner = (db: Database) => db.spyAsyncEffectResult([asyncFunc, 'delta']);
    const outer = (db: Database) => `outer-${db.spyResult([inner])}`;

    const promise = reactor.getResultPromise([outer]);

    reactor.ensureAsyncRun(asyncFunc, 'delta');

    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await Promise.resolve(); // Flush microtasks to confirm the promise is still pending.
    expect(resolved).toBe(false);

    deferred.resolve('done');
    await deferred.promise;
    await Promise.resolve(); // Flush microtasks so the async .then handler runs.
    expect(resolved).toBe(true);

    expect(await promise).toBe('outer-done');
  });

  it('getResultPromise rejects on synchronous errors', async () => {
    const reactor = new Reactor();
    const err = new Error('boom');
    const throwingFunc = () => {
      throw err;
    };

    const promise = reactor.getResultPromise([throwingFunc]);
    await expect(promise).rejects.toBe(err);
  });
});
