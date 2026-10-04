import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { UnsuspendShopDialog } from './UnsuspendShopDialog';

function setup({ open = true, isPending = false } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <UnsuspendShopDialog
        open={open}
        onOpenChange={onOpenChange}
        shopName="Shop A"
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('UnsuspendShopDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByText('Mở khoá shop này?')).not.toBeInTheDocument();
  });

  it('nêu tên shop và hậu quả (sản phẩm hiện lại, nhận đơn mới); KHÔNG có ô lý do (xác nhận nhẹ)', () => {
    setup();

    expect(screen.getByText('Mở khoá shop này?')).toBeInTheDocument();
    expect(screen.getByText(/Sản phẩm của “Shop A” sẽ hiện lại trên sàn/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('bấm "Mở khoá" -> gọi onConfirm đúng 1 lần', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup();

    await user.click(screen.getByRole('button', { name: 'Mở khoá' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('đang gửi (isPending) -> khoá cả 2 nút, không gửi trùng', async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ isPending: true });

    expect(screen.getByRole('button', { name: 'Mở khoá' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mở khoá' }));

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('"Quay lại" đóng hộp thoại mà không mở khoá', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Quay lại' }));

    expect(onOpenChange.mock.calls[0][0]).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
