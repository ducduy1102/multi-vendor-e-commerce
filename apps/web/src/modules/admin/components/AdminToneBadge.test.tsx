import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminShopBadgeTone } from '../admin-status-display';
import { AdminToneBadge } from './AdminToneBadge';

describe('AdminToneBadge', () => {
  it('hiện nhãn đã dịch từ key của namespace admin', () => {
    render(
      withIntl(
        <AdminToneBadge display={{ labelKey: 'refundsStatusFailed', tone: 'destructive' }} />,
      ),
    );

    expect(screen.getByText('Hoàn tiền lỗi')).toBeInTheDocument();
  });

  it.each<[AdminShopBadgeTone, string[]]>([
    ['warning', ['border-warning/40', 'bg-warning/15', 'text-foreground']],
    ['success', ['border-success/30', 'bg-success/10', 'text-success']],
    ['muted', ['text-muted-foreground']],
    ['destructive', ['border-destructive/30', 'bg-background']],
  ])('sắc thái %s dùng đúng token ngữ nghĩa (không màu thô)', (tone, classes) => {
    render(withIntl(<AdminToneBadge display={{ labelKey: 'refundsStatusPending', tone }} />));

    for (const cls of classes) expect(screen.getByText('Đang chờ cổng')).toHaveClass(cls);
  });

  it('sắc thái destructive: nền trắng + viền đỏ nhạt, KHÔNG nền hồng bg-destructive/10 (chữ 12px chỉ đạt 3,97:1 trên nền đó)', () => {
    render(
      withIntl(
        <AdminToneBadge display={{ labelKey: 'refundsStatusFailed', tone: 'destructive' }} />,
      ),
    );

    const badge = screen.getByText('Hoàn tiền lỗi');
    expect(badge).toHaveClass('text-destructive');
    expect(badge).not.toHaveClass('bg-destructive/10');
    // Chế độ tối giữ nền đỏ nhạt cũ của variant (đã đạt) và không có viền.
    expect(badge).toHaveClass('dark:bg-destructive/20', 'dark:border-transparent');
  });

  it('nhận thêm className từ nơi dùng', () => {
    render(
      withIntl(
        <AdminToneBadge
          display={{ labelKey: 'refundsStatusPending', tone: 'muted' }}
          className="shrink-0"
        />,
      ),
    );

    expect(screen.getByText('Đang chờ cổng')).toHaveClass('shrink-0');
  });
});
