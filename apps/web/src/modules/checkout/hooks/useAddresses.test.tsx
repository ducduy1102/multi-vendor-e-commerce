import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as checkoutService from '../services/checkout.service';
import type { Address } from '../types';
import { addressesQueryKey, useAddresses } from './useAddresses';

vi.mock('../services/checkout.service', () => ({
  listAddresses: vi.fn(),
}));

const ADDRESS: Address = {
  id: 'address-1',
  recipientName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Nguyễn Huệ',
  ward: 'Phường Bến Nghé',
  province: 'Hồ Chí Minh',
  isDefault: true,
  createdAt: '2026-09-27T00:00:00.000Z',
};

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useAddresses', () => {
  beforeEach(() => {
    vi.mocked(checkoutService.listAddresses).mockReset();
  });

  it('query key cố định', () => {
    expect(addressesQueryKey()).toEqual(['addresses']);
  });

  it('trả về danh sách địa chỉ từ service', async () => {
    vi.mocked(checkoutService.listAddresses).mockResolvedValue([ADDRESS]);

    const { result } = renderHook(() => useAddresses(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([ADDRESS]);
  });

  it('service lỗi -> isError, không trả dữ liệu dở dang', async () => {
    vi.mocked(checkoutService.listAddresses).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useAddresses(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
