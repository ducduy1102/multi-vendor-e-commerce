import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { MarkRefundCompletedDialog } from './MarkRefundCompletedDialog';

function setup({ open = true, isPending = false } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <MarkRefundCompletedDialog
        open={open}
        onOpenChange={onOpenChange}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('MarkRefundCompletedDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cảnh báo rõ: chỉ ghi nhận khi ĐÃ hoàn tiền thật, hoàn thêm lần nữa là mất tiền', () => {
    setup();

    expect(screen.getByText('Ghi nhận đã hoàn tiền thủ công?')).toBeInTheDocument();
    expect(screen.getByText(/ĐÃ hoàn đủ tiền/)).toBeInTheDocument();
    expect(screen.getByText(/không gọi cổng nữa/)).toBeInTheDocument();
    expect(screen.getByText(/mất tiền thật/)).toBeInTheDocument();
  });

  it('mã tham chiếu BẮT BUỘC: để trống -> lỗi theo field + aria-invalid, KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Ghi nhận đã hoàn' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Vui lòng nhập mã tham chiếu khoản hoàn',
    );
    expect(screen.getByLabelText('Mã tham chiếu của giao dịch hoàn')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('chỉ nhập khoảng trắng cũng coi là chưa nhập', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Mã tham chiếu của giao dịch hoàn'), '    ');
    await user.click(screen.getByRole('button', { name: 'Ghi nhận đã hoàn' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('nhập mã -> onConfirm nhận đúng mã đã trim', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Mã tham chiếu của giao dịch hoàn'), '  VNP-8841  ');
    await user.click(screen.getByRole('button', { name: 'Ghi nhận đã hoàn' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('VNP-8841'));
  });

  it('đúng 100 ký tự gửi được; 101 ký tự -> lỗi đã dịch và KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();
    const field = screen.getByLabelText('Mã tham chiếu của giao dịch hoàn');

    await user.click(field);
    await user.paste('a'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Ghi nhận đã hoàn' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mã tham chiếu tối đa 100 ký tự');
    expect(onConfirm).not.toHaveBeenCalled();

    await user.clear(field);
    await user.paste('a'.repeat(100));
    await user.click(screen.getByRole('button', { name: 'Ghi nhận đã hoàn' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('đang gửi (isPending) -> khoá nút xác nhận lẫn "Quay lại"', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Ghi nhận đã hoàn' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Quay lại" đóng hộp thoại mà không ghi nhận', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('nút xác nhận là nút trung tính (primary), không đỏ — ghi nhận không phá huỷ dữ liệu', () => {
    setup();

    const confirm = screen.getByRole('button', { name: 'Ghi nhận đã hoàn' });
    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).not.toHaveClass('bg-destructive/10');
  });

  it('khai cột lưới tường minh (grid-cols-1)', () => {
    setup();

    expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
  });
});
