import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { OrderPagination } from './OrderPagination';

const HREFS = { prevHref: '/orders?page=1', nextHref: '/orders?page=3' };

describe('OrderPagination', () => {
  it('chỉ 1 trang và đang ở trang 1 -> không render gì', () => {
    const { container } = render(withIntl(<OrderPagination page={1} totalPages={1} {...HREFS} />));

    expect(container).toBeEmptyDOMElement();
  });

  it('trang giữa -> cả 2 link bấm được, hiện "Trang 2 / 3" và trỏ đúng href', () => {
    render(withIntl(<OrderPagination page={2} totalPages={3} {...HREFS} />));

    expect(screen.getByText('Trang 2 / 3')).toBeInTheDocument();
    const prev = screen.getByRole('link', { name: 'Trang trước' });
    const next = screen.getByRole('link', { name: 'Trang sau' });
    expect(prev).toHaveAttribute('href', '/orders?page=1');
    expect(next).toHaveAttribute('href', '/orders?page=3');
    expect(prev).not.toHaveAttribute('aria-disabled', 'true');
    expect(next).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('trang đầu -> "Trang trước" bị vô hiệu (aria-disabled, ra khỏi thứ tự Tab)', () => {
    render(withIntl(<OrderPagination page={1} totalPages={3} {...HREFS} />));

    const prev = screen.getByRole('link', { name: 'Trang trước' });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(prev).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: 'Trang sau' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('trang cuối -> "Trang sau" bị vô hiệu', () => {
    render(withIntl(<OrderPagination page={3} totalPages={3} {...HREFS} />));

    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Trang trước' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('trang vượt quá trang cuối (gõ tay URL) vẫn hiện thanh để có đường quay về', () => {
    render(
      withIntl(
        <OrderPagination
          page={9}
          totalPages={3}
          prevHref="/orders?page=3"
          nextHref="/orders?page=3"
        />,
      ),
    );

    expect(screen.getByRole('link', { name: 'Trang trước' })).toHaveAttribute(
      'href',
      '/orders?page=3',
    );
    expect(screen.getByRole('link', { name: 'Trang sau' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
