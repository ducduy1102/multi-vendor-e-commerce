import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { OrderStatus } from '../types';
import { OrderStatusBadge } from './OrderStatusBadge';

describe('OrderStatusBadge', () => {
  it.each<[OrderStatus, string]>([
    ['AWAITING_PAYMENT', 'Chờ thanh toán'],
    ['PENDING', 'Chờ xác nhận'],
    ['CONFIRMED', 'Đã xác nhận'],
    ['PACKED', 'Đã đóng gói'],
    ['SHIPPING', 'Đang giao'],
    ['COMPLETED', 'Hoàn tất'],
    ['CANCELLED', 'Đã hủy'],
    ['REFUNDED', 'Đã hoàn tiền'],
  ])('%s hiện nhãn tiếng Việt thật, không lộ key thô', (status, label) => {
    render(withIntl(<OrderStatusBadge status={status} />));

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/^status[A-Z]/)).not.toBeInTheDocument();
  });

  it('nhận className bổ sung từ nơi dùng', () => {
    render(withIntl(<OrderStatusBadge status="PENDING" className="shrink-0" />));

    expect(screen.getByText('Chờ xác nhận')).toHaveClass('shrink-0');
  });

  it('chưa thanh toán dùng nền cảnh báo (warning), đã hủy dùng chữ nhạt — đều là token ngữ nghĩa, không màu thô', () => {
    const { rerender } = render(withIntl(<OrderStatusBadge status="AWAITING_PAYMENT" />));
    expect(screen.getByText('Chờ thanh toán').className).toContain('bg-warning/15');

    rerender(withIntl(<OrderStatusBadge status="CANCELLED" />));
    expect(screen.getByText('Đã hủy').className).toContain('text-muted-foreground');
    expect(screen.getByText('Đã hủy').className).not.toMatch(/\b(?:bg|text)-(?:red|blue|green)-/);
  });
});
