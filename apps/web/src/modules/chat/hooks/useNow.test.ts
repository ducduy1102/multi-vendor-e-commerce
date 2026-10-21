import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNow } from './useNow';

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2030-01-10T12:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('chốt "bây giờ" lúc mount rồi cập nhật mỗi phút (mặc định)', () => {
    const { result } = renderHook(() => useNow());
    const mounted = result.current;
    expect(mounted).toBe(Date.parse('2030-01-10T12:00:00.000Z'));

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(result.current).toBe(mounted);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(mounted + 60_000);
  });

  it('chu kỳ tuỳ chỉnh', () => {
    const { result } = renderHook(() => useNow(1_000));

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(result.current).toBe(Date.parse('2030-01-10T12:00:03.000Z'));
  });

  it('gỡ component thì dọn timer (không rò rỉ)', () => {
    const { unmount } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
