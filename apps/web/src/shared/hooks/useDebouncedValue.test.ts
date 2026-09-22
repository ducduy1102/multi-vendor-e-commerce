import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('giữ nguyên giá trị ban đầu cho tới khi đủ delay', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 400));

    expect(result.current).toBe('a');
  });

  it('reset lại timer mỗi lần value đổi trước khi hết delay, chỉ nhận giá trị mới nhất', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 400), {
      initialProps: { value: 0 },
    });

    rerender({ value: 1 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(0);

    rerender({ value: 2 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe(2);
  });

  it('cập nhật giá trị sau đúng delay khi value chỉ đổi 1 lần', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'x' },
    });

    rerender({ value: 'y' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('y');
  });
});
