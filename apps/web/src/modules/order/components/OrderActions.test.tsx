import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { OrderActions } from './OrderActions';

type Flags = Parameters<typeof OrderActions>[0]['order'];

const NO_FLAGS: Flags = { canCancel: false, canConfirmReceived: false, canRetryPayment: false };

function setup(flags: Partial<Flags> = {}, isDisabled = false) {
  const handlers = {
    onCancel: vi.fn(),
    onConfirmReceived: vi.fn(),
    onRetryPayment: vi.fn(),
  };
  const utils = render(
    withIntl(
      <OrderActions order={{ ...NO_FLAGS, ...flags }} isDisabled={isDisabled} {...handlers} />,
    ),
  );
  return { ...utils, ...handlers };
}

describe('OrderActions', () => {
  it('không cờ nào bật -> không render gì (không có nút "disabled" gây hiểu nhầm)', () => {
    const { container } = setup();

    expect(container).toBeEmptyDOMElement();
  });

  it('chỉ hiện đúng nút ứng với cờ BE đã bật', () => {
    setup({ canRetryPayment: true });

    expect(screen.getByRole('button', { name: 'Thanh toán lại' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hủy đơn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đã nhận hàng' })).not.toBeInTheDocument();
  });

  it('đơn chưa thanh toán (có thể vừa thanh toán lại vừa hủy) hiện cả 2 nút', () => {
    setup({ canRetryPayment: true, canCancel: true });

    expect(screen.getByRole('button', { name: 'Thanh toán lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy đơn' })).toBeInTheDocument();
  });

  it('đơn đang giao chỉ có "Đã nhận hàng"', () => {
    setup({ canConfirmReceived: true });

    expect(screen.getByRole('button', { name: 'Đã nhận hàng' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('bấm từng nút gọi đúng callback của nó', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirmReceived, onRetryPayment } = setup({
      canCancel: true,
      canConfirmReceived: true,
      canRetryPayment: true,
    });

    await user.click(screen.getByRole('button', { name: 'Thanh toán lại' }));
    await user.click(screen.getByRole('button', { name: 'Đã nhận hàng' }));
    await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));

    expect(onRetryPayment).toHaveBeenCalledTimes(1);
    expect(onConfirmReceived).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('isDisabled -> khoá mọi nút, bấm không gọi callback (tránh gửi trùng khi đang xử lý)', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirmReceived, onRetryPayment } = setup(
      { canCancel: true, canConfirmReceived: true, canRetryPayment: true },
      true,
    );

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirmReceived).not.toHaveBeenCalled();
    expect(onRetryPayment).not.toHaveBeenCalled();
  });
});
