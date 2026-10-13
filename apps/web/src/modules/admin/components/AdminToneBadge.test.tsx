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
    ['destructive', ['bg-destructive/10']],
  ])('sắc thái %s dùng đúng token ngữ nghĩa (không màu thô)', (tone, classes) => {
    render(withIntl(<AdminToneBadge display={{ labelKey: 'refundsStatusPending', tone }} />));

    for (const cls of classes) expect(screen.getByText('Đang chờ cổng')).toHaveClass(cls);
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
