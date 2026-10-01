import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import * as checkoutService from '../services/checkout.service';
import type { CheckoutPreview } from '../types';
import { checkoutPreviewQueryKey, useCheckoutPreview } from './useCheckoutPreview';

vi.mock('../services/checkout.service', () => ({
  previewCheckout: vi.fn(),
}));

const PREVIEW: CheckoutPreview = {
  orders: [],
  subtotal: '300000',
  shippingTotal: '16500',
  discountTotal: '0',
  grandTotal: '316500',
  discount: null,
  needsAddress: false,
  paymentMethods: [{ method: 'VNPAY', available: true }],
  excludedItems: [],
  blockingIssues: [],
  canPlaceOrder: true,
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useCheckoutPreview', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.previewCheckout).mockReset();
  });

  it('query key đổi theo addressId/voucherCode', () => {
    expect(checkoutPreviewQueryKey({})).toEqual(['checkout', 'preview', null, '']);
    expect(checkoutPreviewQueryKey({ addressId: 'a1', voucherCode: 'SALE10' })).toEqual([
      'checkout',
      'preview',
      'a1',
      'SALE10',
    ]);
  });

  it('trả về preview từ service khi thành công', async () => {
    vi.mocked(checkoutService.previewCheckout).mockResolvedValue(PREVIEW);

    const { result } = renderHook(() => useCheckoutPreview({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(PREVIEW);
  });

  it('NO_PURCHASABLE_ITEMS -> data null (trạng thái "trống", KHÔNG phải lỗi)', async () => {
    vi.mocked(checkoutService.previewCheckout).mockRejectedValue(
      new ApiError('Cart has no purchasable items', 400, 'NO_PURCHASABLE_ITEMS'),
    );

    const { result } = renderHook(() => useCheckoutPreview({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('lỗi khác (vd 404 địa chỉ không tồn tại) -> vẫn là isError, không nuốt lỗi', async () => {
    vi.mocked(checkoutService.previewCheckout).mockRejectedValue(
      new ApiError('Address not found', 404),
    );

    const { result } = renderHook(() => useCheckoutPreview({ addressId: 'bad' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('enabled: false -> không gọi service', () => {
    renderHook(() => useCheckoutPreview({}, { enabled: false }), { wrapper: createWrapper() });

    expect(checkoutService.previewCheckout).not.toHaveBeenCalled();
  });
});
