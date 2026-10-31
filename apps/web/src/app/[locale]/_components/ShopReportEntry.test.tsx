import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopReportEntry } from './ShopReportEntry';

const auth = { user: null as { id: string } | null };
const myShop = {
  data: undefined as { id: string } | null | undefined,
  isPending: false,
};
const useMyShop = vi.fn();
const reportEntry = vi.fn();

vi.mock('@/modules/auth', () => ({
  useAuthStore: (selector: (state: typeof auth) => unknown) => selector(auth),
}));
vi.mock('@/modules/shop', () => ({
  useMyShop: (options: unknown) => {
    useMyShop(options);
    return myShop;
  },
}));
vi.mock('./ReportEntry', () => ({
  ReportEntry: (props: unknown) => {
    reportEntry(props);
    return <button type="button">report-entry</button>;
  },
}));

const SHOP_ID = 'shop-1';

describe('ShopReportEntry (nút "Báo cáo shop" ở trang shop công khai)', () => {
  beforeEach(() => {
    auth.user = null;
    myShop.data = undefined;
    myShop.isPending = false;
    useMyShop.mockReset();
    reportEntry.mockReset();
  });

  it('khách: hiện nút báo cáo loại SHOP (viền) và không hỏi "shop của tôi" (truy vấn bị tắt)', () => {
    render(<ShopReportEntry shopId={SHOP_ID} />);

    expect(screen.getByRole('button', { name: 'report-entry' })).toBeInTheDocument();
    expect(reportEntry).toHaveBeenCalledWith({
      targetType: 'SHOP',
      targetId: SHOP_ID,
      variant: 'outline',
    });
    expect(useMyShop).toHaveBeenCalledWith({ enabled: false });
  });

  it('đã đăng nhập, đang tải "shop của tôi": chưa vẽ gì (không nháy nút rồi biến mất ở chủ shop)', () => {
    auth.user = { id: 'u1' };
    myShop.isPending = true;
    render(<ShopReportEntry shopId={SHOP_ID} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(reportEntry).not.toHaveBeenCalled();
    expect(useMyShop).toHaveBeenCalledWith({ enabled: true });
  });

  it('đã đăng nhập, đây CHÍNH LÀ shop của tôi: ẩn nút', () => {
    auth.user = { id: 'u1' };
    myShop.data = { id: SHOP_ID };
    render(<ShopReportEntry shopId={SHOP_ID} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(reportEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['chưa có shop (data null)', null],
    ['shop của tôi là shop KHÁC', { id: 'other-shop' }],
    ['tải "shop của tôi" lỗi (data undefined, hết pending) — BE chặn bằng 409', undefined],
  ])('đã đăng nhập, %s: vẫn hiện nút', (_name, data) => {
    auth.user = { id: 'u1' };
    myShop.data = data;
    render(<ShopReportEntry shopId={SHOP_ID} />);

    expect(screen.getByRole('button', { name: 'report-entry' })).toBeInTheDocument();
  });
});
