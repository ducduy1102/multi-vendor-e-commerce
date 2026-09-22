import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { archiveProduct } from '../services/product.service';
import type { Product, ProductListItem } from '../types';
import { useArchiveProduct } from './useArchiveProduct';
import { myProductsQueryKey } from './useMyProducts';

vi.mock('../services/product.service', () => ({
  archiveProduct: vi.fn(),
}));

const shopId = 'shop-1';

const archivedProduct: Product = {
  id: 'product-1',
  shopId,
  categoryId: 'cat-1',
  name: 'Áo thun',
  slug: 'ao-thun',
  description: null,
  status: 'ARCHIVED',
  minPrice: '100000',
  maxPrice: '100000',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  attributes: [],
  variants: [],
};

function seedProducts(): ProductListItem[] {
  return [
    {
      id: 'product-1',
      categoryId: 'cat-1',
      name: 'Áo thun',
      slug: 'ao-thun',
      status: 'PUBLISHED',
      minPrice: '100000',
      maxPrice: '100000',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      variants: [],
    },
  ];
}

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(myProductsQueryKey(shopId), seedProducts());

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const { result } = renderHook(() => useArchiveProduct(), { wrapper: Wrapper });
  return { queryClient, result };
}

describe('useArchiveProduct', () => {
  beforeEach(() => {
    vi.mocked(archiveProduct).mockReset();
  });

  it('optimistic update: đổi status thành ARCHIVED trong cache ngay khi mutate, không chờ API trả lời', async () => {
    let resolveArchive!: (value: Product) => void;
    vi.mocked(archiveProduct).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveArchive = resolve;
        }),
    );

    const { queryClient, result } = renderWithClient();

    act(() => {
      result.current.mutate('product-1');
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<ProductListItem[]>(myProductsQueryKey(shopId));
      expect(cached?.[0].status).toBe('ARCHIVED');
    });

    resolveArchive(archivedProduct);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rollback: khi API lỗi, cache trở lại đúng dữ liệu cũ (status PUBLISHED) thay vì giữ ARCHIVED lạc quan', async () => {
    // Reject bất đồng bộ (setTimeout) thay vì mockRejectedValue (reject ngay
    // microtask kế tiếp) — đủ thời gian để waitFor bắt được trạng thái
    // optimistic ARCHIVED trước khi rollback, chứng minh rollback thật sự
    // undo 1 thay đổi đã xảy ra chứ không phải chưa từng đổi.
    vi.mocked(archiveProduct).mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('network fail')), 100)),
    );

    const { queryClient, result } = renderWithClient();

    act(() => {
      result.current.mutate('product-1');
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<ProductListItem[]>(myProductsQueryKey(shopId));
      expect(cached?.[0].status).toBe('ARCHIVED');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<ProductListItem[]>(myProductsQueryKey(shopId));
    expect(cached?.[0].status).toBe('PUBLISHED');
  });
});
