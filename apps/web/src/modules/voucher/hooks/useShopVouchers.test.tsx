import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as voucherService from '../services/voucher.service';
import type { Voucher } from '../types';
import { shopVouchersQueryKey, useShopVouchers } from './useShopVouchers';

vi.mock('../services/voucher.service', () => ({
  listShopVouchers: vi.fn(),
}));

const VOUCHER: Voucher = {
  id: 'voucher-1',
  shopId: 'shop-1',
  code: 'SALE10',
  type: 'PERCENT',
  value: '10',
  minOrderAmount: null,
  maxDiscountAmount: null,
  usageLimit: null,
  perUserLimit: null,
  usedCount: 0,
  isActive: true,
  expiresAt: null,
  createdAt: '2026-09-25T00:00:00.000Z',
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useShopVouchers', () => {
  beforeEach(() => {
    vi.mocked(voucherService.listShopVouchers).mockReset();
  });

  it('query key gắn theo shopId (voucher của 2 shop không lẫn cache)', () => {
    expect(shopVouchersQueryKey('shop-1')).toEqual(['vouchers', 'shop', 'shop-1']);
    expect(shopVouchersQueryKey('shop-2')).not.toEqual(shopVouchersQueryKey('shop-1'));
  });

  it('gọi service đúng shopId và bóc {items} ra mảng voucher', async () => {
    vi.mocked(voucherService.listShopVouchers).mockResolvedValue({ items: [VOUCHER] });

    const { result } = renderHook(() => useShopVouchers('shop-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([VOUCHER]);
    expect(voucherService.listShopVouchers).toHaveBeenCalledWith('shop-1');
  });

  it('service lỗi -> isError, không trả dữ liệu dở dang', async () => {
    vi.mocked(voucherService.listShopVouchers).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useShopVouchers('shop-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
