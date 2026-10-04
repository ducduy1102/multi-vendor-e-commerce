import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminShop } from '../types';
import { AdminShopRow } from './AdminShopRow';

const SHOP: AdminShop = {
  id: 'shop-1',
  ownerId: 'user-1',
  name: 'Shop Thời Trang ABC',
  slug: 'shop-thoi-trang-abc',
  logoUrl: null,
  bannerUrl: null,
  description: null,
  status: 'PENDING',
  statusReason: null,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  owner: { name: 'Nguyễn Văn A', email: 'nguyenvana@example.com' },
};

function renderRow(shop: Partial<AdminShop> = {}, actions?: React.ReactNode) {
  return render(
    withIntl(
      <ul>
        <AdminShopRow shop={{ ...SHOP, ...shop }} actions={actions} />
      </ul>,
    ),
  );
}

describe('AdminShopRow', () => {
  it('hiện shop (tên, slug), chủ shop (tên + email), ngày tạo và trạng thái', () => {
    renderRow();

    expect(screen.getByRole('heading', { name: 'Shop Thời Trang ABC' })).toBeInTheDocument();
    expect(screen.getByText('/shop-thoi-trang-abc')).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByText('nguyenvana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
    const time = screen.getByText(/2026/);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-10-01T12:00:00.000Z');
  });

  it('mỗi trường có nhãn (hiện ở mobile, `md:sr-only` ở desktop để vẫn có trong cây trợ năng)', () => {
    renderRow();

    for (const label of ['Chủ shop', 'Ngày tạo', 'Trạng thái']) {
      const element = screen.getByText(label);
      expect(element).toHaveClass('md:sr-only');
      expect(element).not.toHaveClass('hidden');
    }
  });

  it('có lý do (từ chối/khoá) -> hiện "Lý do: …" kèm đủ nội dung ở title', () => {
    renderRow({ status: 'SUSPENDED', statusReason: 'Bán hàng cấm' });

    const reason = screen.getByText('Lý do: Bán hàng cấm');
    expect(reason).toHaveAttribute('title', 'Bán hàng cấm');
    expect(screen.getByText('Đã khoá')).toBeInTheDocument();
  });

  it('không có lý do -> không có dòng "Lý do"', () => {
    renderRow();

    expect(screen.queryByText(/^Lý do:/)).not.toBeInTheDocument();
  });

  it('chuỗi do chủ shop nhập chứa HTML hiện nguyên dạng text, không chèn thẻ vào trang', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { container } = renderRow({
      name: payload,
      statusReason: payload,
      status: 'REJECTED',
      owner: { name: payload, email: 'a@b.c' },
    });

    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getAllByText(payload, { exact: false }).length).toBeGreaterThan(0);
  });

  it('nút hành động do Container truyền vào được vẽ trong dòng', () => {
    renderRow({}, <button type="button">Duyệt</button>);

    expect(screen.getByRole('button', { name: 'Duyệt' })).toBeInTheDocument();
  });

  it('ô thao tác có `empty:hidden` để shop không còn hành động nào không chiếm chỗ', () => {
    const { container } = renderRow({ status: 'REJECTED' });

    const cells = container.querySelectorAll('li > div');
    expect(cells[cells.length - 1]).toHaveClass('empty:hidden');
    expect(cells[cells.length - 1]).toBeEmptyDOMElement();
  });

  it('logo: có URL -> thẻ img; không có -> không có img (biểu tượng thay thế)', () => {
    const { container, unmount } = renderRow({ logoUrl: 'https://cdn.example.com/l.png' });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/l.png');
    unmount();

    const second = renderRow({ logoUrl: null });
    expect(second.container.querySelector('img')).toBeNull();
  });
});
