import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminShopPagination } from './AdminShopPagination';

function renderPagination(page: number, totalPages: number) {
  return render(
    withIntl(
      <AdminShopPagination
        page={page}
        totalPages={totalPages}
        prevHref="/admin/shops?page=1"
        nextHref="/admin/shops?page=3"
      />,
    ),
  );
}

describe('AdminShopPagination', () => {
  it('chỉ 1 trang và đang ở trang 1 -> không render gì', () => {
    const { container } = renderPagination(1, 1);

    expect(container).toBeEmptyDOMElement();
  });

  it('trang giữa: cả 2 link dùng được, hiện "Trang 2 / 5"', () => {
    renderPagination(2, 5);

    expect(screen.getByText('Trang 2 / 5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trang trước' })).toHaveAttribute(
      'href',
      '/admin/shops?page=1',
    );
    expect(screen.getByRole('link', { name: 'Trang trước' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'href',
      '/admin/shops?page=3',
    );
    expect(screen.getByRole('link', { name: 'Trang sau' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('trang đầu: "Trang trước" bị vô hiệu (aria-disabled, ra khỏi thứ tự Tab)', () => {
    renderPagination(1, 5);

    const prev = screen.getByRole('link', { name: 'Trang trước' });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(prev).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('trang cuối: "Trang sau" bị vô hiệu', () => {
    renderPagination(5, 5);

    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Trang trước' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('trang vượt quá trang cuối (gõ tay URL) vẫn hiện thanh để có đường quay về', () => {
    renderPagination(9, 1);

    expect(screen.getByText('Trang 9 / 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trang trước' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
});
