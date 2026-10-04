import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminShopListSkeleton } from './AdminShopListSkeleton';

describe('AdminShopListSkeleton', () => {
  it('thuần trang trí: toàn bộ khối aria-hidden (vùng bọc ở Container mới có aria-busy + sr-only)', () => {
    const { container } = render(withIntl(<AdminShopListSkeleton />));

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('mặc định 5 dòng, đổi được bằng count', () => {
    const { container, rerender } = render(withIntl(<AdminShopListSkeleton />));
    expect(container.querySelectorAll('ul > li')).toHaveLength(5);

    rerender(withIntl(<AdminShopListSkeleton count={2} />));
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('dùng đúng dòng tiêu đề cột của bảng thật để cột không nhảy khi dữ liệu về', () => {
    const { container } = render(withIntl(<AdminShopListSkeleton />));

    for (const label of ['Shop', 'Chủ shop', 'Ngày tạo', 'Trạng thái', 'Thao tác']) {
      expect(container).toHaveTextContent(label);
    }
  });

  it('skeleton tôn trọng prefers-reduced-motion', () => {
    const { container } = render(withIntl(<AdminShopListSkeleton count={1} />));

    const pulsing = Array.from(container.querySelectorAll('[data-slot="skeleton"]'));
    expect(pulsing.length).toBeGreaterThan(0);
    for (const skeleton of pulsing) {
      expect(skeleton).toHaveClass('motion-reduce:animate-none');
    }
  });
});
