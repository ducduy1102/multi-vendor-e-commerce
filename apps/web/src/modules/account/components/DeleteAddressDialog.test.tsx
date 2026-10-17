import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { DeleteAddressDialog } from './DeleteAddressDialog';

function setup(props: Partial<React.ComponentProps<typeof DeleteAddressDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    withIntl(
      <DeleteAddressDialog
        open
        onOpenChange={onOpenChange}
        recipientName="Nguyễn Văn A"
        willPromoteAnother={false}
        isPending={false}
        onConfirm={onConfirm}
        {...props}
      />,
    ),
  );
  return { onConfirm, onOpenChange };
}

describe('DeleteAddressDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Xoá địa chỉ này?')).not.toBeInTheDocument();
  });

  it('mở -> nêu rõ địa chỉ của ai và nói đơn đã đặt không bị ảnh hưởng', () => {
    setup();

    expect(screen.getByText('Xoá địa chỉ này?')).toBeInTheDocument();
    expect(screen.getByText(/Địa chỉ của Nguyễn Văn A sẽ bị xoá/)).toBeInTheDocument();
    expect(screen.getByText(/đơn hàng đã đặt không bị ảnh hưởng/)).toBeInTheDocument();
  });

  it('xoá địa chỉ mặc định khi còn địa chỉ khác -> báo trước địa chỉ nào lên thay', () => {
    setup({ willPromoteAnother: true });

    expect(
      screen.getByText(/Địa chỉ được thêm gần nhất sẽ trở thành mặc định/),
    ).toBeInTheDocument();
  });

  it('tên người nhận dài không dấu cách: header khai grid-cols-1 + mô tả break-words (không làm hộp thoại rộng ra)', () => {
    setup({ recipientName: 'W'.repeat(100) });

    const description = screen.getByText(new RegExp('W{100}'));
    expect(description).toHaveClass('w-full', 'break-words');
    expect(description.closest('[data-slot="alert-dialog-header"]')).toHaveClass('grid-cols-1');
  });

  it('địa chỉ thường -> KHÔNG có dòng chú ý về địa chỉ mặc định', () => {
    setup({ willPromoteAnother: false });

    expect(screen.queryByText(/sẽ trở thành mặc định/)).not.toBeInTheDocument();
  });

  it('bấm "Xoá địa chỉ" -> gọi onConfirm đúng một lần', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Xoá địa chỉ' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('"Giữ lại" đóng hộp thoại mà không xoá', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Giữ lại' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('đang xoá -> khoá cả 2 nút và đổi chữ, không xoá trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    expect(screen.getByRole('button', { name: 'Giữ lại' })).toBeDisabled();
    const confirm = screen.getByRole('button', { name: 'Đang xoá...' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
