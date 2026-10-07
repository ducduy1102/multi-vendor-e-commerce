import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { RejectOrderDialog } from './RejectOrderDialog';

function setup({ open = true, isPending = false } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <RejectOrderDialog
        open={open}
        onOpenChange={onOpenChange}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('RejectOrderDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Từ chối đơn hàng này?')).not.toBeInTheDocument();
  });

  it('nói rõ hậu quả: đơn bị hủy, hàng trả lại kho, người mua thấy lý do, không khôi phục được', () => {
    setup();

    expect(screen.getByText('Từ chối đơn hàng này?')).toBeInTheDocument();
    expect(screen.getByText(/trả lại kho/)).toBeInTheDocument();
    expect(screen.getByText(/Người mua sẽ thấy lý do/)).toBeInTheDocument();
    expect(screen.getByText(/Không thể khôi phục/)).toBeInTheDocument();
  });

  it('lý do BẮT BUỘC: để trống -> lỗi đã dịch theo field, KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Từ chối đơn' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(screen.getByLabelText('Lý do từ chối')).toHaveAttribute('aria-invalid', 'true');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('chỉ nhập khoảng trắng cũng coi là chưa nhập lý do', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Lý do từ chối'), '    ');
    await user.click(screen.getByRole('button', { name: 'Từ chối đơn' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập lý do');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('nhập lý do -> onConfirm nhận đúng lý do đã trim (dạng chuỗi)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Lý do từ chối'), '  Hết hàng  ');
    await user.click(screen.getByRole('button', { name: 'Từ chối đơn' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith('Hết hàng');
  });

  it('lý do quá 500 ký tự -> lỗi đã dịch và KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByLabelText('Lý do từ chối'));
    await user.paste('a'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Từ chối đơn' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lý do tối đa 500 ký tự');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang gửi (isPending) -> khoá nút xác nhận lẫn nút giữ đơn, không gửi trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Từ chối đơn' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Giữ đơn hàng' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Giữ đơn hàng" đóng hộp thoại mà không từ chối', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Giữ đơn hàng' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
