import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminShopNotesSheet } from './AdminShopNotesSheet';

const SHOP = { name: 'Shop Thời Trang ABC', slug: 'shop-thoi-trang-abc', logoUrl: null };

function setup(shop = SHOP, locale: 'vi' | 'en' = 'vi') {
  return render(
    withIntl(
      <AdminShopNotesSheet open onOpenChange={() => undefined} shop={shop}>
        <p>phần ghi chú</p>
      </AdminShopNotesSheet>,
      locale,
    ),
  );
}

describe('AdminShopNotesSheet', () => {
  it('hộp thoại có tên là tên shop, mô tả nêu slug và hiện phần ghi chú do Container truyền vào', () => {
    setup();

    const dialog = screen.getByRole('dialog', { name: 'Shop Thời Trang ABC' });
    expect(dialog).toHaveTextContent('Ghi chú nội bộ về shop /shop-thoi-trang-abc');
    expect(screen.getByText('phần ghi chú')).toBeInTheDocument();
  });

  it('tên shop rất dài, không dấu cách vẫn bẻ dòng được (không làm ngăn rộng ra)', () => {
    setup({ ...SHOP, name: 'x'.repeat(100) });

    expect(screen.getByRole('heading', { name: 'x'.repeat(100) }).className).toContain(
      '[overflow-wrap:anywhere]',
    );
  });

  it('bản tiếng Anh: mô tả không lẫn tiếng Việt', () => {
    setup(SHOP, 'en');

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Internal notes about the shop /shop-thoi-trang-abc',
    );
    expect(screen.queryByText(/Ghi chú/)).not.toBeInTheDocument();
  });
});
