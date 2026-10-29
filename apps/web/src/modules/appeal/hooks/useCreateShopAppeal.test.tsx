import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeOwnerAppeal } from '../appeal.fixtures';
import * as appealService from '../services/appeal.service';
import { shopAppealsQueryKey } from './appeal-query-keys';
import { useCreateShopAppeal } from './useCreateShopAppeal';

vi.mock('../services/appeal.service', () => ({
  createShopAppeal: vi.fn(),
  getShopAppeals: vi.fn(),
}));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useCreateShopAppeal', () => {
  beforeEach(() => {
    vi.mocked(appealService.createShopAppeal).mockReset();
  });

  it('gửi đúng shop và lời kháng nghị cho service, trả kháng nghị vừa tạo', async () => {
    vi.mocked(appealService.createShopAppeal).mockResolvedValue(makeOwnerAppeal());
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateShopAppeal(SHOP_ID), { wrapper });

    let created: unknown;
    await act(async () => {
      created = await result.current.mutateAsync('Xin xem xét lại');
    });

    expect(appealService.createShopAppeal).toHaveBeenCalledWith(SHOP_ID, {
      message: 'Xin xem xét lại',
    });
    expect(created).toEqual(makeOwnerAppeal());
  });

  it('thành công -> làm mới lịch sử kháng nghị của ĐÚNG shop đó', async () => {
    vi.mocked(appealService.createShopAppeal).mockResolvedValue(makeOwnerAppeal());
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateShopAppeal(SHOP_ID), { wrapper });

    await act(() => result.current.mutateAsync('x'));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: shopAppealsQueryKey(SHOP_ID) });
  });

  it('THẤT BẠI cũng làm mới (thường là 409: Admin vừa mở khoá shop hoặc đã gửi ở tab khác ⇒ dữ liệu đang hiện đã cũ)', async () => {
    vi.mocked(appealService.createShopAppeal).mockRejectedValue(new Error('409'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateShopAppeal(SHOP_ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('x').catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: shopAppealsQueryKey(SHOP_ID) });
  });

  it('khoá cache có tiền tố "appeal" và gắn theo shop — shop khác không bị làm mới', () => {
    expect(shopAppealsQueryKey('a')).toEqual(['appeal', 'shop', 'a']);
    expect(shopAppealsQueryKey('a')).not.toEqual(shopAppealsQueryKey('b'));
  });
});
