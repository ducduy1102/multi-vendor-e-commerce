import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { RefundPaymentDialog } from './RefundPaymentDialog';

function setup({ open = true, isPending = false } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <RefundPaymentDialog
        open={open}
        onOpenChange={onOpenChange}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('RefundPaymentDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('nói rõ hậu quả: hoàn TOÀN BỘ về phương thức ban đầu, không ảnh hưởng đơn/kho, không hoàn tác', () => {
    setup();

    expect(screen.getByText('Hoàn tiền thanh toán này?')).toBeInTheDocument();
    expect(screen.getByText(/Hoàn toàn bộ số tiền/)).toBeInTheDocument();
    expect(screen.getByText(/Không ảnh hưởng tới đơn hay kho/)).toBeInTheDocument();
    expect(screen.getByText(/Không thể hoàn tác/)).toBeInTheDocument();
  });

  it('lý do là TUỲ CHỌN: để trống vẫn gửi được, onConfirm nhận undefined, không báo lỗi', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Hoàn tiền' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('có lý do -> onConfirm nhận lý do đã trim', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Lý do (không bắt buộc)'), '  Khách trả hai lần  ');
    await user.click(screen.getByRole('button', { name: 'Hoàn tiền' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Khách trả hai lần'));
  });

  it('chỉ nhập khoảng trắng -> coi như không có lý do (undefined)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Lý do (không bắt buộc)'), '    ');
    await user.click(screen.getByRole('button', { name: 'Hoàn tiền' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(undefined));
  });

  it('lý do 501 ký tự -> lỗi đã dịch và KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByLabelText('Lý do (không bắt buộc)'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Hoàn tiền' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lý do tối đa 500 ký tự');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang gửi (isPending) -> khoá nút xác nhận lẫn "Quay lại", không hoàn trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Hoàn tiền' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Quay lại" đóng hộp thoại mà không hoàn', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('khai cột lưới tường minh (grid-cols-1): lý do dài không dấu cách không làm hộp thoại rộng ra ngoài màn hình', () => {
    setup();

    expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
  });
});
