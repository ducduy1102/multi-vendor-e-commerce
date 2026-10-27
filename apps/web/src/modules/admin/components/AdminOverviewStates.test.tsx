import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminOverviewEmpty, AdminOverviewError } from './AdminOverviewStates';

describe('AdminOverviewEmpty', () => {
  it('nói rõ không còn việc và có hai lối đi tiếp tới đúng hai khu quản trị', () => {
    render(withIntl(<AdminOverviewEmpty />));

    expect(
      screen.getByRole('heading', { name: 'Không còn việc nào chờ xử lý' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem danh sách shop' })).toHaveAttribute(
      'href',
      '/admin/shops',
    );
    expect(screen.getByRole('link', { name: 'Xem khu hoàn tiền' })).toHaveAttribute(
      'href',
      '/admin/refunds',
    );
  });
});

describe('AdminOverviewError', () => {
  it('là alert, không lộ chi tiết lỗi, có nút "Thử lại" gọi onRetry', async () => {
    const onRetry = vi.fn();
    render(withIntl(<AdminOverviewError onRetry={onRetry} isRetrying={false} />));

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được số việc đang chờ.');
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đang thử lại -> nút bị khoá (không bấm dồn)', () => {
    render(withIntl(<AdminOverviewError onRetry={vi.fn()} isRetrying />));

    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeDisabled();
  });
});
