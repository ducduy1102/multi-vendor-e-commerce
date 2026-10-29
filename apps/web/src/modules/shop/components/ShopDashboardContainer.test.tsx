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
    supportEmail: null as string | null,
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

describe('ShopDashboardContainer — dòng liên hệ hỗ trợ ở banner (Week11.md 4.2)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shop bị khoá + BE trả supportEmail -> banner có link mailto tới đúng địa chỉ đó', () => {
    mocks.shop.current = { ...makeShop('SUSPENDED'), supportEmail: 'support@example.com' };
    render(withIntl(<ShopDashboardContainer />));

    expect(screen.getByRole('link', { name: 'support@example.com' })).toHaveAttribute(
      'href',
      'mailto:support@example.com',
    );
  });

  it('BE không đặt supportEmail (null) -> banner không có dòng liên hệ', () => {
    mocks.shop.current = makeShop('SUSPENDED');
    render(withIntl(<ShopDashboardContainer />));

    expect(screen.queryByText(/Liên hệ hỗ trợ/)).not.toBeInTheDocument();
  });
});

describe('ShopDashboardContainer — slot kháng nghị do page ghép (Week11.md 4.6)', () => {
  afterEach(() => {
    cleanup();
  });

  it('hiện slot NGAY SAU banner trạng thái và TRƯỚC form', () => {
    mocks.shop.current = makeShop('SUSPENDED');
    render(withIntl(<ShopDashboardContainer appealSlot={<div data-testid="appeal-slot" />} />));

    const banner = document.querySelector('[data-slot="alert"]') as HTMLElement;
    const slot = screen.getByTestId('appeal-slot');
    const form = document.querySelector('form') as HTMLFormElement;
    expect(banner.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('không truyền slot -> không vẽ gì thêm (trang chạy như cũ)', () => {
    mocks.shop.current = makeShop('SUSPENDED');
    render(withIntl(<ShopDashboardContainer />));

    expect(screen.queryByTestId('appeal-slot')).not.toBeInTheDocument();
  });
});
