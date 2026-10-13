import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { OrderActions } from './OrderActions';

type Flags = Parameters<typeof OrderActions>[0]['order'];

const NO_FLAGS: Flags = {
  canCancel: false,
  canRequestCancel: false,
  canRequestReturn: false,
  canConfirmReceived: false,
  canRetryPayment: false,
};

function setup(
  flags: Partial<Flags> = {},
  isDisabled = false,
  cancelBlockedKey?: 'cancelBlockedProcessing' | null,
) {
  const handlers = {
    onCancel: vi.fn(),
    onRequestCancel: vi.fn(),
    onRequestReturn: vi.fn(),
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

  describe('yêu cầu hủy / trả hàng (Tuần 9)', () => {
    it('canRequestCancel -> chỉ nút "Yêu cầu hủy" (shop đã xác nhận/đóng gói), bấm gọi onRequestCancel', async () => {
      const user = userEvent.setup();
      const { onRequestCancel, onRequestReturn, onCancel } = setup({ canRequestCancel: true });

      expect(screen.getAllByRole('button')).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Yêu cầu hủy' }));

      expect(onRequestCancel).toHaveBeenCalledTimes(1);
      expect(onRequestReturn).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('canRequestReturn -> chỉ nút "Yêu cầu trả hàng/hoàn tiền" (đã nhận hàng, trong cửa sổ), bấm gọi onRequestReturn', async () => {
      const user = userEvent.setup();
      const { onRequestReturn, onRequestCancel } = setup({ canRequestReturn: true });

      expect(screen.getAllByRole('button')).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Yêu cầu trả hàng/hoàn tiền' }));

      expect(onRequestReturn).toHaveBeenCalledTimes(1);
      expect(onRequestCancel).not.toHaveBeenCalled();
    });

    it('"Hủy đơn" (hủy ngay) và "Yêu cầu hủy" là hai nút khác nhau theo hai cờ khác nhau', () => {
      const { unmount } = setup({ canCancel: true });
      expect(screen.getByRole('button', { name: 'Hủy đơn' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Yêu cầu hủy' })).not.toBeInTheDocument();
      unmount();

      setup({ canRequestCancel: true });
      expect(screen.getByRole('button', { name: 'Yêu cầu hủy' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Hủy đơn' })).not.toBeInTheDocument();
    });

    it('đơn đã nhận hàng: "Đã nhận hàng" không cùng lúc "Yêu cầu trả hàng" khi BE chỉ bật một cờ; bật cả hai thì hiện cả hai', () => {
      const { unmount } = setup({ canConfirmReceived: true });
      expect(screen.queryByRole('button', { name: /Yêu cầu trả hàng/ })).not.toBeInTheDocument();
      unmount();

      setup({ canConfirmReceived: true, canRequestReturn: true });
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('isDisabled khoá cả hai nút yêu cầu', async () => {
      const user = userEvent.setup();
      const { onRequestCancel, onRequestReturn } = setup(
        { canRequestCancel: true, canRequestReturn: true },
        true,
      );

      for (const button of screen.getAllByRole('button')) {
        expect(button).toBeDisabled();
        await user.click(button);
      }

      expect(onRequestCancel).not.toHaveBeenCalled();
      expect(onRequestReturn).not.toHaveBeenCalled();
    });

    it('có thể gửi yêu cầu hủy thì KHÔNG hiện nút Hủy bị khoá dù có truyền lý do (cờ BE luôn thắng)', () => {
      setup({ canRequestCancel: true }, false, 'cancelBlockedProcessing');

      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.queryByText(/chưa gửi được yêu cầu hủy/)).not.toBeInTheDocument();
    });
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
      const { onCancel } = setup({}, false, 'cancelBlockedProcessing');

      const cancel = screen.getByRole('button', { name: 'Hủy đơn' });
      expect(cancel).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByText(/hiện chưa gửi được yêu cầu hủy/)).toBeInTheDocument();
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
        'Shop đã bắt đầu xử lý đơn hàng này, hiện chưa gửi được yêu cầu hủy.',
      );
    });

    it('có lý do nhưng BE lại cho hủy (canCancel) -> hiện nút Hủy bình thường, KHÔNG hiện bản khoá/lý do', async () => {
      const user = userEvent.setup();
      const { onCancel } = setup({ canCancel: true }, false, 'cancelBlockedProcessing');

      expect(screen.getAllByRole('button', { name: 'Hủy đơn' })).toHaveLength(1);
      expect(screen.queryByText(/hiện chưa gửi được yêu cầu hủy/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Hủy đơn' }));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('chỉ có nút khoá (không cờ nào bật) vẫn render — đơn đã xác nhận chẳng có hành động nào khác', () => {
      const { container } = setup({}, false, 'cancelBlockedProcessing');

      expect(container).not.toBeEmptyDOMElement();
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('không truyền lý do (danh sách đơn) -> không có nút khoá nào', () => {
      const { container } = setup({}, false, undefined);

      expect(container).toBeEmptyDOMElement();
    });
  });
});

// Ma trận cờ (Week9.md 3.9): 5 cờ của người mua ⇒ 32 tổ hợp. Mỗi tổ hợp phải hiện ĐÚNG tập nút của các cờ đã
// bật — không thiếu, không thừa, không nút nào hiện nhầm theo cờ khác — và khi đang có hành động chạy thì mọi
// nút đều bị khoá. Các test theo kịch bản ở trên chỉ thử vài tổ hợp; ma trận bắt lỗi kiểu đổi nhầm cờ giữa hai nút
// hoặc quên cờ mới trong điều kiện "không render gì".
const FLAG_BUTTONS = [
  ['canRetryPayment', 'Thanh toán lại'],
  ['canConfirmReceived', 'Đã nhận hàng'],
  ['canCancel', 'Hủy đơn'],
  ['canRequestCancel', 'Yêu cầu hủy'],
  ['canRequestReturn', 'Yêu cầu trả hàng/hoàn tiền'],
] as const;

const FLAG_MATRIX = Array.from({ length: 2 ** FLAG_BUTTONS.length }, (_unused, mask) => {
  const isOn = (index: number) => ((mask >> index) & 1) === 1;
  const onButtons = FLAG_BUTTONS.filter((_button, index) => isOn(index));
  return {
    title: onButtons.length ? onButtons.map(([flag]) => flag).join(' + ') : 'không cờ nào',
    flags: Object.fromEntries(FLAG_BUTTONS.map(([flag], index) => [flag, isOn(index)])) as Flags,
    expected: onButtons.map(([, label]) => label),
  };
});

describe('OrderActions — ma trận cờ', () => {
  it('đủ 32 tổ hợp', () => {
    expect(FLAG_MATRIX).toHaveLength(32);
    expect(new Set(FLAG_MATRIX.map((row) => row.title)).size).toBe(32);
  });

  it.each(FLAG_MATRIX)('$title -> đúng các nút của cờ đã bật', ({ flags, expected }) => {
    for (const isDisabled of [false, true]) {
      const { unmount } = setup(flags, isDisabled);
      const buttons = screen.queryAllByRole('button');

      expect(buttons.map((button) => button.textContent).sort()).toEqual([...expected].sort());
      for (const button of buttons) {
        if (isDisabled) expect(button).toBeDisabled();
        else expect(button).toBeEnabled();
      }
      unmount();
    }
  });
});
