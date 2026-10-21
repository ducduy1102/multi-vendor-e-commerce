import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSessionReset, runSessionResets } from './session-reset';

describe('session-reset', () => {
  const cleanups: Array<() => void> = [];
  const register = (resetter: () => void) => {
    const unregister = registerSessionReset(resetter);
    cleanups.push(unregister);
    return unregister;
  };

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    vi.restoreAllMocks();
  });

  it('chạy MỌI bộ dọn đã đăng ký, mỗi bộ một lần', () => {
    const first = vi.fn();
    const second = vi.fn();
    register(first);
    register(second);

    runSessionResets();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('đăng ký cùng một hàm hai lần vẫn chỉ chạy một lần', () => {
    const resetter = vi.fn();
    register(resetter);
    register(resetter);

    runSessionResets();

    expect(resetter).toHaveBeenCalledTimes(1);
  });

  it('huỷ đăng ký ⇒ không chạy nữa', () => {
    const resetter = vi.fn();
    const unregister = register(resetter);
    unregister();

    runSessionResets();

    expect(resetter).not.toHaveBeenCalled();
  });

  it('không có bộ dọn nào: gọi vẫn an toàn', () => {
    expect(() => runSessionResets()).not.toThrow();
  });

  it('một bộ dọn ném lỗi KHÔNG chặn các bộ còn lại, và lỗi được báo ra ngoài luồng render', () => {
    const boom = new Error('hỏng');
    const before = vi.fn(() => {
      throw boom;
    });
    const after = vi.fn();
    register(before);
    register(after);
    // Chặn queueMicrotask để quan sát việc "ném lại ngoài luồng" mà không làm vitest báo lỗi chưa bắt.
    const queued: Array<() => void> = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      queued.push(callback);
    });

    expect(() => runSessionResets()).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    expect(queued).toHaveLength(1);
    expect(() => queued[0]()).toThrow(boom);
  });
});
