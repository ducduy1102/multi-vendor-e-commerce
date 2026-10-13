import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { CancelOrderDialog } from './CancelOrderDialog';

interface Props {
  open?: boolean;
  isGroupCancel?: boolean;
  isPaidOnline?: boolean;
  isPending?: boolean;
}

function setup({
  open = true,
  isGroupCancel = false,
  isPaidOnline = false,
  isPending = false,
}: Props = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <CancelOrderDialog
        open={open}
        onOpenChange={onOpenChange}
        isGroupCancel={isGroupCancel}
        isPaidOnline={isPaidOnline}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('CancelOrderDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Hủy đơn hàng này?')).not.toBeInTheDocument();
  });

  it('đơn thường: cảnh báo không thể khôi phục, KHÔNG nhắc tới hủy cả nhóm', () => {
    setup();

    expect(screen.getByText('Hủy đơn hàng này?')).toBeInTheDocument();
    expect(screen.getByText('Sau khi hủy, đơn hàng không thể khôi phục.')).toBeInTheDocument();
    expect(screen.queryByText(/cùng lần đặt hàng/)).not.toBeInTheDocument();
  });

  it('đơn chưa thanh toán: nói rõ mọi đơn cùng lần đặt (kể cả shop khác) bị hủy cùng', () => {
    setup({ isGroupCancel: true });

    expect(screen.getByText(/cùng lần đặt hàng \(kể cả đơn của shop khác\)/)).toBeInTheDocument();
  });

  it('đơn đã thanh toán online: thêm dòng nói tiền sẽ được hoàn về phương thức thanh toán ban đầu', () => {
    setup({ isPaidOnline: true });

    expect(
      screen.getByText('Tiền đã thanh toán sẽ được hoàn về phương thức thanh toán ban đầu.'),
    ).toBeInTheDocument();
  });

  it('đơn chưa thanh toán hoặc COD: KHÔNG hứa hoàn tiền (không có khoản nào để hoàn)', () => {
    setup({ isPaidOnline: false });

    expect(screen.queryByText(/hoàn về phương thức thanh toán ban đầu/)).not.toBeInTheDocument();
  });

  it('hộp thoại khai cột tường minh (grid-cols-1): lý do 500 ký tự liền không làm nội dung tràn khỏi hộp thoại ở 390px', () => {
    setup();

    // Hồi quy từ trình duyệt thật (lỗi có từ Tuần 8): không có lớp này, cột ngầm định lấy min-content của
    // textarea và nội dung rộng ~4400px (jsdom không có layout nên chỉ giữ được lớp class).
    expect(screen.getByRole('alertdialog')).toHaveClass('grid-cols-1');
  });

  it('để trống lý do -> onConfirm(undefined) (lý do tuỳ chọn)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it('nhập lý do -> onConfirm nhận đúng lý do đã trim', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Lý do (không bắt buộc)'), '  Đặt nhầm sản phẩm  ');
    await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Đặt nhầm sản phẩm'));
  });

  it('lý do quá 500 ký tự -> hiện lỗi đã dịch theo field và KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    // paste thay vì type để không gõ 501 lần
    await user.click(screen.getByLabelText('Lý do (không bắt buộc)'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lý do tối đa 500 ký tự');
    expect(screen.getByLabelText('Lý do (không bắt buộc)')).toHaveAttribute('aria-invalid', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang gửi (isPending) -> khoá cả nút xác nhận lẫn nút giữ đơn, không gửi trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Hủy đơn' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Giữ đơn hàng' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Giữ đơn hàng" đóng hộp thoại mà không hủy', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Giữ đơn hàng' }));

    // base-ui gọi onOpenChange(open, eventDetails) — chỉ quan tâm đối số đầu.
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
