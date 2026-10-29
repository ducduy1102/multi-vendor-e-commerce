import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as orderService from '../services/order.service';
import type { SellerOrderDetail } from '../types';
import { sellerOrderListQueryKey, sellerOrderQueryKey } from './order-query-keys';
import { useUpdateOrderInternalNote } from './useUpdateOrderInternalNote';

vi.mock('../services/order.service', () => ({ updateOrderInternalNote: vi.fn() }));

const asDetail = (internalNote: string | null) =>
  ({ id: 'o1', status: 'PENDING', internalNote }) as unknown as SellerOrderDetail;

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidate, wrapper };
}

describe('useUpdateOrderInternalNote', () => {
  beforeEach(() => {
    vi.mocked(orderService.updateOrderInternalNote).mockReset();
  });

  it('shopId cố định lúc khai hook, orderId và note truyền lúc mutate: service nhận (shopId, orderId, { note })', async () => {
    vi.mocked(orderService.updateOrderInternalNote).mockResolvedValue(asDetail('x'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateOrderInternalNote('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'o1', note: 'Đã gọi khách' }));

    expect(orderService.updateOrderInternalNote).toHaveBeenCalledWith('shop-1', 'o1', {
      note: 'Đã gọi khách',
    });
  });

  it('thành công -> ghi chi tiết BE trả về vào cache của ĐÚNG đơn; KHÔNG làm mới danh sách (ghi chú không nằm ở danh sách)', async () => {
    vi.mocked(orderService.updateOrderInternalNote).mockResolvedValue(asDetail('bản lưu'));
    const { wrapper, queryClient, invalidate } = setup();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'o1'), asDetail(null));
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'o2'), asDetail('đơn khác'));
    queryClient.setQueryData(sellerOrderListQueryKey('shop-1', { page: 1 }), { items: [] });
    const { result } = renderHook(() => useUpdateOrderInternalNote('shop-1'), { wrapper });

    await act(() => result.current.mutateAsync({ orderId: 'o1', note: 'bản lưu' }));

    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'o1'))).toEqual(
      asDetail('bản lưu'),
    );
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'o2'))).toEqual(
      asDetail('đơn khác'),
    );
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('lỗi -> ném lại và làm mới nhánh seller của shop (đơn có thể vừa biến mất khỏi tầm nhìn); cache chi tiết không bị ghi đè', async () => {
    vi.mocked(orderService.updateOrderInternalNote).mockRejectedValue(new Error('boom'));
    const { wrapper, queryClient, invalidate } = setup();
    queryClient.setQueryData(sellerOrderQueryKey('shop-1', 'o1'), asDetail('cũ'));
    const { result } = renderHook(() => useUpdateOrderInternalNote('shop-1'), { wrapper });

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ orderId: 'o1', note: 'mới' });
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toBeInstanceOf(Error);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['orders', 'seller', 'shop-1'] });
    expect(queryClient.getQueryData(sellerOrderQueryKey('shop-1', 'o1'))).toEqual(asDetail('cũ'));
  });
});
