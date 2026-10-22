import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { scheduleInvalidate } from './schedule-invalidate';

let queryClient: QueryClient;
let invalidate: MockInstance<QueryClient['invalidateQueries']>;

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient();
  invalidate = vi.spyOn(queryClient, 'invalidateQueries');
});

afterEach(() => {
  vi.useRealTimers();
});

const keysInvalidated = () =>
  invalidate.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown }).queryKey));

describe('scheduleInvalidate', () => {
  it('chưa làm mới ngay: chờ hết độ trễ', () => {
    scheduleInvalidate(queryClient, ['k']);

    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['k'] });
  });

  it('nhiều lần gọi dồn dập cho cùng key ⇒ chỉ MỘT lần làm mới (lô)', () => {
    scheduleInvalidate(queryClient, ['k']);
    vi.advanceTimersByTime(100);
    scheduleInvalidate(queryClient, ['k']);
    scheduleInvalidate(queryClient, ['k']);
    vi.advanceTimersByTime(1000);

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('KHÔNG đẩy lùi thời hạn: lần làm mới đầu luôn chạy sau tối đa độ trễ kể từ sự kiện đầu tiên', () => {
    scheduleInvalidate(queryClient, ['k']);
    vi.advanceTimersByTime(200);
    scheduleInvalidate(queryClient, ['k']); // không kéo dài
    vi.advanceTimersByTime(50);

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('sự kiện đến SAU khi đã làm mới thì hẹn một lần mới (không bỏ sót)', () => {
    scheduleInvalidate(queryClient, ['k']);
    vi.advanceTimersByTime(250);
    scheduleInvalidate(queryClient, ['k']);
    vi.advanceTimersByTime(250);

    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('key khác nhau độc lập; cùng key trên QueryClient khác nhau cũng độc lập', () => {
    const other = new QueryClient();
    const otherInvalidate = vi.spyOn(other, 'invalidateQueries');

    scheduleInvalidate(queryClient, ['a']);
    scheduleInvalidate(queryClient, ['b']);
    scheduleInvalidate(other, ['a']);
    vi.advanceTimersByTime(250);

    expect(keysInvalidated().sort()).toEqual(['["a"]', '["b"]']);
    expect(otherInvalidate).toHaveBeenCalledTimes(1);
  });

  it('độ trễ tuỳ chỉnh được tôn trọng', () => {
    scheduleInvalidate(queryClient, ['k'], 1000);

    vi.advanceTimersByTime(999);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
