import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { SellerOrderListItem } from '../types';
import { SellerOrderActions } from './SellerOrderActions';

type Flags = Pick<SellerOrderListItem, 'canConfirm' | 'canPack' | 'canShip' | 'canReject'>;
const NO_FLAGS: Flags = { canConfirm: false, canPack: false, canShip: false, canReject: false };

function setup(flags: Partial<Flags> = {}, isDisabled = false) {
  const handlers = { onConfirm: vi.fn(), onPack: vi.fn(), onShip: vi.fn(), onReject: vi.fn() };
  const utils = render(
    withIntl(
      <SellerOrderActions
        order={{ ...NO_FLAGS, ...flags }}
        isDisabled={isDisabled}
        {...handlers}
      />,
    ),
  );
  return { ...utils, ...handlers };
}

describe('SellerOrderActions', () => {
  it('không cờ nào bật -> không render gì (đơn đã giao/hoàn tất/hủy không có nút)', () => {
    const { container } = setup();

    expect(container).toBeEmptyDOMElement();
  });

  it('đơn COD chờ xác nhận: "Xác nhận" và "Từ chối", bấm gọi đúng callback', async () => {
    const user = userEvent.setup();
    const { onConfirm, onReject, onPack, onShip } = setup({ canConfirm: true, canReject: true });

    await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await user.click(screen.getByRole('button', { name: 'Từ chối' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onPack).not.toHaveBeenCalled();
    expect(onShip).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Đóng gói' })).not.toBeInTheDocument();
  });

  it('đơn đã trả online chờ xác nhận: chỉ "Xác nhận", KHÔNG có "Từ chối" (BE không bật canReject)', () => {
    setup({ canConfirm: true });

    expect(screen.getByRole('button', { name: 'Xác nhận' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Từ chối' })).not.toBeInTheDocument();
  });

  it('đã xác nhận: chỉ "Đóng gói"', async () => {
    const user = userEvent.setup();
    const { onPack } = setup({ canPack: true });

    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Đóng gói' }));

    expect(onPack).toHaveBeenCalledTimes(1);
  });

  it('đã đóng gói: chỉ "Giao hàng"', async () => {
    const user = userEvent.setup();
    const { onShip } = setup({ canShip: true });

    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Giao hàng' }));

    expect(onShip).toHaveBeenCalledTimes(1);
  });

  it('đang có hành động chạy (isDisabled) -> khoá mọi nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onConfirm, onReject } = setup({ canConfirm: true, canReject: true }, true);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toBeDisabled();
    await user.click(buttons[0]);
    await user.click(buttons[1]);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });
});
