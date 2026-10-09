import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { RetryRefundDialog } from './RetryRefundDialog';

function setup({ open = true, isPending = false } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <RetryRefundDialog
        open={open}
        onOpenChange={onOpenChange}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('RetryRefundDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('nói rõ cổng tự loại trùng (cùng mã tham chiếu cũ)', () => {
    setup();

    expect(screen.getByText('Thử lại hoàn tiền?')).toBeInTheDocument();
    expect(
      screen.getByText(/đúng mã tham chiếu của khoản hoàn này nên cổng tự loại trùng/),
    ).toBeInTheDocument();
  });

  it('nhắc dùng "Ghi nhận hoàn tay" nếu đã hoàn tay trên trang của cổng (tránh hoàn hai lần)', () => {
    setup();

    expect(
      screen.getByText(/đã hoàn tiền thủ công trên trang quản trị của cổng/),
    ).toBeInTheDocument();
    expect(screen.getByText(/"Ghi nhận hoàn tay" thay vì thử lại/)).toBeInTheDocument();
  });

  it('bấm "Thử lại" gọi onConfirm đúng một lần', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('"Quay lại" đóng hộp thoại mà không thử lại', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang gửi (isPending) -> khoá cả nút xác nhận lẫn "Quay lại" (hộp thoại giữ mở tới khi xong), không gửi trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Thử lại' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('nút xác nhận là nút trung tính (primary), không đỏ — thử lại không phá huỷ dữ liệu', () => {
    setup();

    const confirm = screen.getByRole('button', { name: 'Thử lại' });
    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).not.toHaveClass('bg-destructive/10');
  });
});
