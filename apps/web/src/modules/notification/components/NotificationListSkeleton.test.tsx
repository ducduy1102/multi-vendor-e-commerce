import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotificationListSkeleton } from './NotificationListSkeleton';
import { NOTIFICATION_ROW_CLASS } from './notification-layout.constants';

describe('NotificationListSkeleton', () => {
  it('chỉ trang trí: danh sách aria-hidden, mặc định 6 dòng', () => {
    const { container } = render(<NotificationListSkeleton />);

    const list = container.querySelector('ul');
    expect(list).toHaveAttribute('aria-hidden', 'true');
    expect(list?.querySelectorAll('li')).toHaveLength(6);
  });

  it('số dòng tuỳ chỉnh', () => {
    const { container } = render(<NotificationListSkeleton count={3} />);

    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('dùng CHUNG class dòng với NotificationItem để không nhảy layout khi dữ liệu về', () => {
    const { container } = render(<NotificationListSkeleton count={1} />);

    for (const token of NOTIFICATION_ROW_CLASS.split(' ')) {
      expect(container.querySelector('li')).toHaveClass(token);
    }
  });

  it('tôn trọng prefers-reduced-motion: mọi khối skeleton tắt animate khi reduce', () => {
    const { container } = render(<NotificationListSkeleton count={2} />);

    const blocks = container.querySelectorAll('[data-slot="skeleton"]');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(block).toHaveClass('motion-reduce:animate-none');
  });
});
