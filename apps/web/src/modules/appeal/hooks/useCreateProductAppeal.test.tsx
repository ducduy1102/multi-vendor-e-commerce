import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeOwnerAppeal } from '../appeal.fixtures';
import * as appealService from '../services/appeal.service';
import { productAppealsQueryKey, shopAppealsQueryKey } from './appeal-query-keys';
import { useCreateProductAppeal } from './useCreateProductAppeal';

vi.mock('../services/appeal.service', () => ({
  createProductAppeal: vi.fn(),
  getProductAppeals: vi.fn(),
}));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('useCreateProductAppeal', () => {
  beforeEach(() => {
    vi.mocked(appealService.createProductAppeal).mockReset();
  });

  it('gửi đúng shop, sản phẩm và lời kháng nghị cho service, trả kháng nghị vừa tạo', async () => {
    vi.mocked(appealService.createProductAppeal).mockResolvedValue(makeOwnerAppeal());
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProductAppeal(SHOP_ID, PRODUCT_ID), { wrapper });

    let created: unknown;
    await act(async () => {
      created = await result.current.mutateAsync('Xin xem xét lại');
    });

    expect(appealService.createProductAppeal).toHaveBeenCalledWith(SHOP_ID, PRODUCT_ID, {
      message: 'Xin xem xét lại',
    });
    expect(created).toEqual(makeOwnerAppeal());
  });

  it('thành công -> làm mới lịch sử kháng nghị của ĐÚNG sản phẩm đó (và không đụng khoá của shop)', async () => {
    vi.mocked(appealService.createProductAppeal).mockResolvedValue(makeOwnerAppeal());
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateProductAppeal(SHOP_ID, PRODUCT_ID), { wrapper });

    await act(() => result.current.mutateAsync('x'));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productAppealsQueryKey(PRODUCT_ID) });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: shopAppealsQueryKey(SHOP_ID) });
  });

  it('THẤT BẠI cũng làm mới (thường là 409: Admin vừa khôi phục sản phẩm hoặc đã gửi ở tab khác ⇒ dữ liệu đang hiện đã cũ)', async () => {
    vi.mocked(appealService.createProductAppeal).mockRejectedValue(new Error('409'));
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useCreateProductAppeal(SHOP_ID, PRODUCT_ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('x').catch(() => undefined);
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: productAppealsQueryKey(PRODUCT_ID) });
  });

  it('khoá cache có tiền tố "appeal", tách khỏi khoá của shop và gắn theo sản phẩm — sản phẩm khác không bị làm mới', () => {
    expect(productAppealsQueryKey('p')).toEqual(['appeal', 'product', 'p']);
    expect(productAppealsQueryKey('p')).not.toEqual(productAppealsQueryKey('q'));
    expect(productAppealsQueryKey('p')).not.toEqual(shopAppealsQueryKey('p'));
  });
});
