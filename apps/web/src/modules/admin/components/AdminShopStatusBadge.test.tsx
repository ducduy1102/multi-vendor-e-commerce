import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { ShopStatus } from '../types';
import { AdminShopStatusBadge } from './AdminShopStatusBadge';

describe('AdminShopStatusBadge', () => {
  it.each<[ShopStatus, string]>([
    ['PENDING', 'Chờ duyệt'],
    ['APPROVED', 'Đã duyệt'],
    ['REJECTED', 'Đã từ chối'],
    ['SUSPENDED', 'Đã khoá'],
  ])('%s hiện nhãn tiếng Việt thật, không lộ key thô', (status, label) => {
    render(withIntl(<AdminShopStatusBadge status={status} />));

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/^status[A-Z]/)).not.toBeInTheDocument();
  });

  it('nhận className bổ sung từ nơi dùng', () => {
    render(withIntl(<AdminShopStatusBadge status="PENDING" className="shrink-0" />));

    expect(screen.getByText('Chờ duyệt')).toHaveClass('shrink-0');
  });

  it('chỉ dùng token ngữ nghĩa: chờ duyệt = warning nhạt, đã duyệt = success, bị khoá = destructive, từ chối = chữ nhạt', () => {
    const { rerender } = render(withIntl(<AdminShopStatusBadge status="PENDING" />));
    expect(screen.getByText('Chờ duyệt').className).toContain('bg-warning/15');

    rerender(withIntl(<AdminShopStatusBadge status="APPROVED" />));
    expect(screen.getByText('Đã duyệt').className).toContain('text-success');

    rerender(withIntl(<AdminShopStatusBadge status="SUSPENDED" />));
    expect(screen.getByText('Đã khoá').className).toContain('text-destructive');

    rerender(withIntl(<AdminShopStatusBadge status="REJECTED" />));
    const rejected = screen.getByText('Đã từ chối').className;
    expect(rejected).toContain('text-muted-foreground');
    expect(rejected).not.toMatch(/\b(?:bg|text)-(?:red|blue|green|orange)-/);
  });
});
