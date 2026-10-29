import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminAppealListSkeleton } from './AdminAppealListSkeleton';

afterEach(() => {
  cleanup();
});

describe('AdminAppealListSkeleton', () => {
  it('chỉ mang tính trang trí (aria-hidden) và mặc định vẽ 5 dòng', () => {
    const { container } = render(withIntl(<AdminAppealListSkeleton status="PENDING" />));

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('ul > li')).toHaveLength(5);
  });

  it('nhận số dòng tuỳ ý', () => {
    const { container } = render(withIntl(<AdminAppealListSkeleton status="PENDING" count={2} />));

    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('dùng đúng khung và dòng tiêu đề của bảng thật để không nhảy layout', () => {
    const { container } = render(withIntl(<AdminAppealListSkeleton status="PENDING" />));

    expect(container.firstElementChild).toHaveClass('overflow-hidden', 'rounded-lg', 'border');
    expect(container.textContent).toContain('Lời kháng nghị');
  });

  it('tab "Chờ xử lý" vẽ khung hai nút hành động mỗi dòng; các tab còn lại thì ô thao tác rỗng (khớp dòng thật)', () => {
    const pending = render(withIntl(<AdminAppealListSkeleton status="PENDING" count={1} />));
    const pendingCell = pending.container.querySelector('li > div:last-child') as HTMLElement;
    expect(pendingCell.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    pending.unmount();

    for (const status of ['ACCEPTED', 'REJECTED', 'CLOSED'] as const) {
      const { container, unmount } = render(
        withIntl(<AdminAppealListSkeleton status={status} count={1} />),
      );
      const cell = container.querySelector('li > div:last-child') as HTMLElement;
      expect([status, cell.children.length]).toEqual([status, 0]);
      expect(cell).toHaveClass('empty:hidden');
      unmount();
    }
  });

  it('hoạt ảnh tôn trọng prefers-reduced-motion', () => {
    const { container } = render(withIntl(<AdminAppealListSkeleton status="PENDING" count={1} />));

    for (const skeleton of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(skeleton).toHaveClass('motion-reduce:animate-none');
    }
  });
});
