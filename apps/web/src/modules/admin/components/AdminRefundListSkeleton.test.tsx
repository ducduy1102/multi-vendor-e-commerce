import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ADMIN_REFUND_GRID_CLASS, ADMIN_REFUND_ROW_CLASS } from './admin-refund-row.constants';
import { AdminRefundListSkeleton } from './AdminRefundListSkeleton';

describe('AdminRefundListSkeleton', () => {
  it('thuần trang trí: toàn bộ khối aria-hidden (vùng bọc ở nơi dùng mới có aria-busy + sr-only)', () => {
    const { container } = render(withIntl(<AdminRefundListSkeleton tab="disputes" />));

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('mặc định 4 dòng, đổi được bằng count', () => {
    const { container, rerender } = render(withIntl(<AdminRefundListSkeleton tab="disputes" />));
    expect(container.querySelectorAll('ul > li')).toHaveLength(4);

    rerender(withIntl(<AdminRefundListSkeleton tab="disputes" count={2} />));
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
  });

  it.each([
    ['disputes', 'Yêu cầu'],
    ['failed', 'Khoản hoàn'],
    ['payments', 'Các đơn của lần đặt'],
  ] as const)(
    'tab %s: dùng đúng dòng tiêu đề của bảng thật ("%s") để cột không nhảy khi dữ liệu về',
    (tab, label) => {
      const { container } = render(withIntl(<AdminRefundListSkeleton tab={tab} />));

      expect(container).toHaveTextContent(label);
      expect(container).toHaveTextContent('Thao tác');
    },
  );

  it('mỗi dòng dùng đúng hằng số lưới dùng chung với dòng thật (cùng template cột, 4 ô)', () => {
    const { container } = render(withIntl(<AdminRefundListSkeleton tab="disputes" count={1} />));

    const row = container.querySelector('ul > li') as HTMLElement;
    for (const cls of [
      ...ADMIN_REFUND_GRID_CLASS.split(' '),
      ...ADMIN_REFUND_ROW_CLASS.split(' '),
    ]) {
      expect(row).toHaveClass(cls);
    }
    expect(row.children).toHaveLength(4);
  });

  it('chuyển động tôn trọng prefers-reduced-motion', () => {
    const { container } = render(withIntl(<AdminRefundListSkeleton tab="disputes" count={1} />));

    for (const bone of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(bone).toHaveClass('motion-reduce:animate-none');
    }
  });
});
