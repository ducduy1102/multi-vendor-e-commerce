import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { cartQueryKeys } from '@/modules/cart';

import { useRefreshCartOnce } from './useRefreshCartOnce';

function setup({ strict = false } = {}) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => {
    const tree = <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return { queryClient, invalidate, wrapper };
}

describe('useRefreshCartOnce', () => {
  it('chưa sẵn sàng -> không làm mới giỏ', () => {
    const { invalidate, wrapper } = setup();

    renderHook(() => useRefreshCartOnce(false), { wrapper });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('sẵn sàng -> làm mới đúng nhánh giỏ hàng (mọi biến thể: user, guest)', () => {
    const { invalidate, wrapper } = setup();

    renderHook(() => useRefreshCartOnce(true), { wrapper });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cartQueryKeys.all });
  });

  it('chuyển từ chưa sẵn sàng sang sẵn sàng -> làm mới đúng 1 lần, render lại nhiều lần không lặp', () => {
    const { invalidate, wrapper } = setup();
    const { rerender } = renderHook(({ ready }) => useRefreshCartOnce(ready), {
      wrapper,
      initialProps: { ready: false },
    });
    expect(invalidate).not.toHaveBeenCalled();

    rerender({ ready: true });
    rerender({ ready: true });
    rerender({ ready: true });

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('sẵn sàng rồi lại chưa rồi lại sẵn sàng (polling/refetch) -> vẫn chỉ 1 lần', () => {
    const { invalidate, wrapper } = setup();
    const { rerender } = renderHook(({ ready }) => useRefreshCartOnce(ready), {
      wrapper,
      initialProps: { ready: true },
    });

    rerender({ ready: false });
    rerender({ ready: true });

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('React StrictMode (effect chạy 2 lần ở dev) -> vẫn chỉ 1 lần', () => {
    const { invalidate, wrapper } = setup({ strict: true });

    renderHook(() => useRefreshCartOnce(true), { wrapper });

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('thật sự làm cache giỏ cũ bị đánh dấu cần tải lại (giỏ trên Header/BottomTabBar)', () => {
    const { queryClient, wrapper } = setup();
    const key = cartQueryKeys.user('user-1', '');
    queryClient.setQueryData(key, { shops: [{ id: 'shop-1' }] });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    renderHook(() => useRefreshCartOnce(true), { wrapper });

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
