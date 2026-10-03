import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { OrderActions } from './OrderActions';

type Flags = Parameters<typeof OrderActions>[0]['order'];

const NO_FLAGS: Flags = { canCancel: false, canConfirmReceived: false, canRetryPayment: false };

function setup(
  flags: Partial<Flags> = {},
  isDisabled = false,
  cancelBlockedKey?: 'cancelBlockedPaidOnline' | 'cancelBlockedProcessing' | null,
) {
  const handlers = {
    onCancel: vi.fn(),
    onConfirmReceived: vi.fn(),
    onRetryPayment: vi.fn(),
  };
  const utils = render(
    withIntl(
      <OrderActions
        order={{ ...NO_FLAGS, ...flags }}
        isDisabled={isDisabled}
        cancelBlockedKey={cancelBlockedKey}
        {...handlers}
      />,
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

  describe('nút Hủy bị khoá kèm lý do (trang chi tiết)', () => {
    it('BE không cho hủy + có lý do -> nút Hủy bị khoá, câu giải thích hiện ngay bên dưới, không gọi callback', async () => {
      const user = userEvent.setup();
      const { onCancel } = setup({}, false, 'cancelBlockedPaidOnline');

      const cancel = screen.getByRole('button', { name: 'Hủy đơn' });
      expect(cancel).toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.getByText(/đã thanh toán trực tuyến nên chưa thể hủy lúc này/),
      ).toBeInTheDocument();
      await user.click(cancel);

      expect(onCancel).not.toHaveBeenCalled();
    });

    it('nút khoá vẫn nhận focus bàn phím và được nối với câu giải thích (aria-describedby)', async () => {
      const user = userEvent.setup();
      setup({}, false, 'cancelBlockedProcessing');

      await user.tab();

      const cancel = screen.getByRole('button', { name: 'Hủy đơn' });
      expect(cancel).toHaveFocus();
      expect(cancel).toHaveAccessibleDescription(
        'Shop đã bắt đầu xử lý đơn hàng này nên không thể hủy.',
      );
    });

    it('có lý do nhưng BE lại cho hủy (canCancel) -> hiện nút Hủy bình thường, KHÔNG hiện bản khoá/lý do', async () => {
      const user = userEvent.setup();
      const { onCancel } = setup({ canCancel: true }, false, 'cancelBlockedPaidOnline');

      expect(screen.getAllByRole('button', { name: 'Hủy đơn' })).toHaveLength(1);
      expect(screen.queryByText(/chưa thể hủy lúc này/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('chỉ có nút khoá (không cờ nào bật) vẫn render — đơn đã trả online chờ xác nhận chẳng có hành động nào khác', () => {
      const { container } = setup({}, false, 'cancelBlockedPaidOnline');

      expect(container).not.toBeEmptyDOMElement();
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('không truyền lý do (danh sách đơn) -> không có nút khoá nào', () => {
      const { container } = setup({}, false, undefined);

      expect(container).toBeEmptyDOMElement();
    });
  });
});
