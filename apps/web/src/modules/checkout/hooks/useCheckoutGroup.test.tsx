import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as checkoutService from '../services/checkout.service';
import type { CheckoutGroup } from '../types';
import {
  checkoutGroupQueryKey,
  POLL_MAX_MS,
  resolvePollInterval,
  useCheckoutGroup,
} from './useCheckoutGroup';

vi.mock('../services/checkout.service', () => ({
  getCheckoutGroup: vi.fn(),
}));

const GROUP: CheckoutGroup = {
  id: 'group-1',
  status: 'AWAITING_PAYMENT',
  canRetry: true,
  expiresAt: '2026-09-27T04:15:00.000Z',
  createdAt: '2026-09-27T04:00:00.000Z',
  totalAmount: '320000',
  paymentMethod: 'VNPAY',
  latestPaymentStatus: 'PENDING',
  orders: [],
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useCheckoutGroup', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.getCheckoutGroup).mockReset();
  });

  it('query key gắn theo groupId (2 nhóm không lẫn cache)', () => {
    expect(checkoutGroupQueryKey('group-1')).toEqual(['checkout', 'group', 'group-1']);
    expect(checkoutGroupQueryKey('group-2')).not.toEqual(checkoutGroupQueryKey('group-1'));
  });

  it('gọi service đúng groupId và trả về nhóm', async () => {
    vi.mocked(checkoutService.getCheckoutGroup).mockResolvedValue(GROUP);

    const { result } = renderHook(() => useCheckoutGroup('group-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(GROUP);
    expect(checkoutService.getCheckoutGroup).toHaveBeenCalledWith('group-1');
  });

  it('groupId rỗng -> không gọi service (enabled=false)', () => {
    renderHook(() => useCheckoutGroup(''), { wrapper: createWrapper() });

    expect(checkoutService.getCheckoutGroup).not.toHaveBeenCalled();
  });

  // Week7.md 3.6/1.10: polling chỉ chạy khi còn AWAITING_PAYMENT, tối đa POLL_MAX_MS rồi dừng hẳn —
  // test hàm thuần thay vì giả lập timer thật qua react-query (không mong manh, không cần fake timers).
  describe('resolvePollInterval', () => {
    it('AWAITING_PAYMENT, chưa quá POLL_MAX_MS -> tiếp tục polling', () => {
      expect(resolvePollInterval('AWAITING_PAYMENT', 0)).toBe(2000);
      expect(resolvePollInterval('AWAITING_PAYMENT', POLL_MAX_MS - 1)).toBe(2000);
    });

    it('AWAITING_PAYMENT nhưng đã quá POLL_MAX_MS -> dừng polling', () => {
      expect(resolvePollInterval('AWAITING_PAYMENT', POLL_MAX_MS)).toBe(false);
      expect(resolvePollInterval('AWAITING_PAYMENT', POLL_MAX_MS + 5000)).toBe(false);
    });

    it.each([
      'PAID',
      'PAYMENT_FAILED',
      'PAYMENT_EXPIRED',
      'CANCELLED',
      'PAID_AFTER_EXPIRY',
    ] as const)('trạng thái đã ổn định (%s) -> dừng polling ngay dù mới bắt đầu', (status) => {
      expect(resolvePollInterval(status, 0)).toBe(false);
    });

    it('chưa có dữ liệu (status undefined) -> không tự polling thêm', () => {
      expect(resolvePollInterval(undefined, 0)).toBe(false);
    });
  });
});
