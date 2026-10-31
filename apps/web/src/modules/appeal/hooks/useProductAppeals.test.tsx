import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { makeOwnerAppeal, makeShopAppeals } from '../appeal.fixtures';
import * as appealService from '../services/appeal.service';
import { productAppealsQueryKey } from './appeal-query-keys';
import { useProductAppeals } from './useProductAppeals';

vi.mock('../services/appeal.service', () => ({
  getProductAppeals: vi.fn(),
  createProductAppeal: vi.fn(),
}));

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

function setup() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('useProductAppeals', () => {
  beforeEach(() => {
    vi.mocked(appealService.getProductAppeals).mockReset();
  });

  it('gọi service với ĐÚNG shop và sản phẩm, trả lịch sử + canAppeal', async () => {
    const response = makeShopAppeals({ appeals: [makeOwnerAppeal()], canAppeal: true });
    vi.mocked(appealService.getProductAppeals).mockResolvedValue(response);
    const { wrapper } = setup();

    const { result } = renderHook(() => useProductAppeals(SHOP_ID, PRODUCT_ID), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(appealService.getProductAppeals).toHaveBeenCalledWith(SHOP_ID, PRODUCT_ID);
  });

  it('lưu cache dưới khoá theo sản phẩm (nút ở danh sách và mục ở trang sửa dùng chung một mục cache)', async () => {
    vi.mocked(appealService.getProductAppeals).mockResolvedValue(makeShopAppeals());
    const { queryClient, wrapper } = setup();

    renderHook(() => useProductAppeals(SHOP_ID, PRODUCT_ID), { wrapper });

    await waitFor(() =>
      expect(queryClient.getQueryData(productAppealsQueryKey(PRODUCT_ID))).toBeDefined(),
    );
  });

  it.each([401, 403, 404])('lỗi %i là kết quả chắc chắn ⇒ KHÔNG thử lại', async (status) => {
    vi.mocked(appealService.getProductAppeals).mockRejectedValue(new ApiError('x', status));
    const { wrapper } = setup();

    const { result } = renderHook(() => useProductAppeals(SHOP_ID, PRODUCT_ID), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(appealService.getProductAppeals).toHaveBeenCalledTimes(1);
  });
});
