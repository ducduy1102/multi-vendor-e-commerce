import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminShopListSkeleton } from './AdminShopListSkeleton';

describe('AdminShopListSkeleton', () => {
  it('thuần trang trí: toàn bộ khối aria-hidden (vùng bọc ở Container mới có aria-busy + sr-only)', () => {
    const { container } = render(withIntl(<AdminShopListSkeleton status="PENDING" />));

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('mặc định 5 dòng, đổi được bằng count', () => {
    const { container, rerender } = render(withIntl(<AdminShopListSkeleton status="PENDING" />));
    expect(container.querySelectorAll('ul > li')).toHaveLength(5);

    rerender(withIntl(<AdminShopListSkeleton status="PENDING" count={2} />));
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('dùng đúng dòng tiêu đề cột của bảng thật để cột không nhảy khi dữ liệu về', () => {
    const { container } = render(withIntl(<AdminShopListSkeleton status="PENDING" />));

    for (const label of ['Shop', 'Chủ shop', 'Chờ từ', 'Trạng thái', 'Thao tác']) {
      expect(container).toHaveTextContent(label);
    }
  });

  it.each([
    ['PENDING', 'Chờ từ'],
    ['APPROVED', 'Duyệt lúc'],
    ['REJECTED', 'Từ chối lúc'],
    ['SUSPENDED', 'Khoá lúc'],
  ] as const)(
    'tab %s: tiêu đề cột ngày là "%s" — giống hệt bảng thật nên cột không nhảy khi dữ liệu về',
    (status, label) => {
      const { container } = render(withIntl(<AdminShopListSkeleton status={status} />));

      expect(container).toHaveTextContent(label);
    },
  );

  it.each([
    ['PENDING', 3, true],
    ['SUSPENDED', 3, true],
    ['APPROVED', 2, false],
    ['REJECTED', 1, false],
  ] as const)(
    'tab %s: cột Thao tác có %i thanh nút, xếp dọc đủ cột = %s — cùng quy tắc với nút thật để không nhảy layout',
    (status, buttons, isStacked) => {
      const { container } = render(withIntl(<AdminShopListSkeleton status={status} count={1} />));

      const cell = container.querySelector('li > div:last-child');
      expect(cell?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(buttons);
      if (isStacked) {
        expect(cell).toHaveClass('lg:flex-col', 'lg:items-stretch');
      } else {
        expect(cell).toHaveClass('lg:justify-end');
        expect(cell).not.toHaveClass('lg:flex-col');
      }
    },
  );

  it('thẻ 2 cột như bảng thật: ô shop, trạng thái và thao tác chiếm cả hàng, chủ shop và ngày chia đôi (không nhảy layout)', () => {
    const { container } = render(withIntl(<AdminShopListSkeleton status="PENDING" count={1} />));

    const cells = Array.from(container.querySelector('li')?.children ?? []);
    expect(cells).toHaveLength(5);
    const [shop, owner, date, status, actions] = cells;
    for (const cell of [shop, status, actions])
      expect(cell).toHaveClass('col-span-2', 'lg:col-span-1');
    for (const cell of [owner, date]) expect(cell).not.toHaveClass('col-span-2');
  });

  it('skeleton tôn trọng prefers-reduced-motion', () => {
    const { container } = render(withIntl(<AdminShopListSkeleton status="PENDING" count={1} />));

    const pulsing = Array.from(container.querySelectorAll('[data-slot="skeleton"]'));
    expect(pulsing.length).toBeGreaterThan(0);
    for (const skeleton of pulsing) {
      expect(skeleton).toHaveClass('motion-reduce:animate-none');
    }
  });
});
