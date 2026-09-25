import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import * as wishlistService from '../services/wishlist.service';
import type { WishlistItem } from '../types';
import { WishlistPageContainer } from './WishlistPageContainer';

vi.mock('../services/wishlist.service', () => ({
  listMyWishlist: vi.fn(),
}));

function renderContainer(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(withIntl(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>));
}

function makeItem(overrides: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: 'product-1',
    categoryId: 'cat-1',
    name: 'Áo thun nam',
    slug: 'ao-thun-nam',
    minPrice: '100000',
    maxPrice: '150000',
    imageUrl: null,
    isAvailable: true,
    ...overrides,
  };
}

describe('WishlistPageContainer', () => {
  it('đang tải -> hiện skeleton, aria-busy', async () => {
    vi.mocked(wishlistService.listMyWishlist).mockReturnValue(new Promise(() => {}));

    const { container } = renderContainer(<WishlistPageContainer />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('lỗi tải -> hiện thông báo lỗi', async () => {
    vi.mocked(wishlistService.listMyWishlist).mockRejectedValue(new Error('network error'));

    renderContainer(<WishlistPageContainer />);

    await waitFor(() => {
      expect(
        screen.getByText('Không tải được danh sách yêu thích, vui lòng thử lại'),
      ).toBeInTheDocument();
    });
  });

  it('danh sách rỗng -> hiện empty state', async () => {
    vi.mocked(wishlistService.listMyWishlist).mockResolvedValue({ items: [] });

    renderContainer(<WishlistPageContainer />);

    await waitFor(() => {
      expect(screen.getByText('Bạn chưa thích sản phẩm nào.')).toBeInTheDocument();
    });
  });

  it('có sản phẩm -> render đủ ProductPreviewCard, item isAvailable=false hiện badge + không phải Link', async () => {
    vi.mocked(wishlistService.listMyWishlist).mockResolvedValue({
      items: [
        makeItem({ id: 'p1', name: 'Còn bán', isAvailable: true }),
        makeItem({ id: 'p2', name: 'Đã ngừng bán', slug: 'da-ngung-ban', isAvailable: false }),
      ],
    });

    renderContainer(<WishlistPageContainer />);

    await waitFor(() => {
      expect(screen.getByText('Còn bán')).toBeInTheDocument();
    });
    expect(screen.getByText('Đã ngừng bán')).toBeInTheDocument();
    expect(screen.getByText('Ngừng bán')).toBeInTheDocument();

    // Chỉ đúng 1 link (item còn bán) — item ngừng bán không phải Link.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
