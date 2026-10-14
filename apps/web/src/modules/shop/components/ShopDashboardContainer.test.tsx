import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ShopDashboardContainer } from './ShopDashboardContainer';

const mocks = vi.hoisted(() => ({
  shop: { current: null as Record<string, unknown> | null },
}));

// Chỉ thay useRouter — giữ Link thật (cần cho các link ở đầu trang).
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../hooks/useMyShop', () => ({
  useMyShop: () => ({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: mocks.shop.current,
  }),
}));
vi.mock('../hooks/useUpdateShop', () => ({
  useUpdateShop: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useResubmitShop', () => ({
  useResubmitShop: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useDescribeShopError', () => ({
  useDescribeShopError: () => () => 'lỗi',
}));

function makeShop(status: string) {
  return {
    id: 'shop-1',
    ownerId: 'user-1',
    name: 'Shop ABC',
    slug: 'shop-abc',
    logoUrl: null,
    bannerUrl: null,
    description: null,
    status,
    statusReason: null,
    statusChangedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('ShopDashboardContainer — link "Xem trang shop" (Week9.md 6.3)', () => {
  beforeEach(() => {
    mocks.shop.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('shop APPROVED -> có link tới trang công khai /shops/<slug>', () => {
    mocks.shop.current = makeShop('APPROVED');
    render(withIntl(<ShopDashboardContainer />));

    expect(screen.getByRole('link', { name: 'Xem trang shop' })).toHaveAttribute(
      'href',
      '/shops/shop-abc',
    );
  });

  it.each(['PENDING', 'REJECTED', 'SUSPENDED'])(
    'shop %s -> KHÔNG có link (trang công khai trả 404 cho trạng thái này)',
    (status) => {
      mocks.shop.current = makeShop(status);
      render(withIntl(<ShopDashboardContainer />));

      expect(screen.queryByRole('link', { name: 'Xem trang shop' })).not.toBeInTheDocument();
      // Link quản lý sản phẩm sẵn có không bị ảnh hưởng.
      expect(screen.getByRole('link', { name: 'Quản lý sản phẩm' })).toBeInTheDocument();
    },
  );
});
