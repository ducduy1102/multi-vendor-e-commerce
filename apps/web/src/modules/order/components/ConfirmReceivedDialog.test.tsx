import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ConfirmReceivedDialog } from './ConfirmReceivedDialog';

function setup({ open = true, isPending = false } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    withIntl(
      <ConfirmReceivedDialog
        open={open}
        onOpenChange={onOpenChange}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { onConfirm, onOpenChange };
}

describe('ConfirmReceivedDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Xác nhận đã nhận hàng?')).not.toBeInTheDocument();
  });

  it('mở -> hiện tiêu đề và giải thích hậu quả (đơn sẽ hoàn tất)', () => {
    setup();

    expect(screen.getByText('Xác nhận đã nhận hàng?')).toBeInTheDocument();
    expect(screen.getByText(/đơn hàng sẽ hoàn tất/)).toBeInTheDocument();
  });

  it('bấm "Đã nhận hàng" -> gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Đã nhận hàng' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('"Quay lại" đóng hộp thoại mà không xác nhận', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    // base-ui gọi onOpenChange(open, eventDetails) — chỉ quan tâm đối số đầu.
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang gửi (isPending) -> khoá cả 2 nút, không xác nhận trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Đã nhận hàng' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
