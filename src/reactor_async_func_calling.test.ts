import { describe, it, expect, vi } from 'vitest';
import { Reactor, AsyncCallStatus, asyncCallResult, asyncCallStatus } from './reactor';

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
});
