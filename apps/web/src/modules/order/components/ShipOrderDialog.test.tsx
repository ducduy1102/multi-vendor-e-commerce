import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ShipOrderDialog } from './ShipOrderDialog';

function setup({ open = true, isPending = false } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <ShipOrderDialog
        open={open}
        onOpenChange={onOpenChange}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('ShipOrderDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Giao đơn hàng này?')).not.toBeInTheDocument();
  });

  it('có 2 ô nhập (đơn vị vận chuyển, mã vận đơn) bắt đầu trống', () => {
    setup();

    expect(screen.getByLabelText('Đơn vị vận chuyển')).toHaveValue('');
    expect(screen.getByLabelText('Mã vận đơn')).toHaveValue('');
  });

  it('nhập đủ -> onConfirm nhận đúng giá trị đã trim', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Đơn vị vận chuyển'), '  Giao Hàng Nhanh ');
    await user.type(screen.getByLabelText('Mã vận đơn'), 'GHN123456');
    await user.click(screen.getByRole('button', { name: 'Giao hàng' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual({
      carrier: 'Giao Hàng Nhanh',
      trackingCode: 'GHN123456',
    });
  });

  it('để trống cả hai (shop tự giao) -> vẫn giao được, không trường nào bị gửi rỗng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Giao hàng' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual({ carrier: undefined, trackingCode: undefined });
  });

  it('Enter trong ô nhập gửi form (dùng được bằng bàn phím)', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.type(screen.getByLabelText('Mã vận đơn'), 'ABC{Enter}');

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0][0]).toEqual({ carrier: undefined, trackingCode: 'ABC' });
  });

  it('mã vận đơn quá 100 ký tự -> lỗi đã dịch đúng field, KHÔNG gọi onConfirm', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByLabelText('Mã vận đơn'));
    await user.paste('a'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Giao hàng' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Mã vận đơn tối đa 100 ký tự');
    expect(screen.getByLabelText('Mã vận đơn')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Đơn vị vận chuyển')).not.toHaveAttribute('aria-invalid');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đơn vị vận chuyển quá 100 ký tự -> lỗi riêng của field đó', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByLabelText('Đơn vị vận chuyển'));
    await user.paste('a'.repeat(101));
    await user.click(screen.getByRole('button', { name: 'Giao hàng' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Đơn vị vận chuyển tối đa 100 ký tự',
    );
  });

  it('đang gửi (isPending) -> khoá nút giao và nút quay lại, không gửi trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    const confirm = screen.getByRole('button', { name: 'Giao hàng' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Quay lại" đóng hộp thoại mà không giao', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    // base-ui gọi onOpenChange(open, eventDetails) — chỉ quan tâm đối số đầu.
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
