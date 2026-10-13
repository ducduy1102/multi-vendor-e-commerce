import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { OrderActionDialogsState, OrderActionTarget } from '../hooks/useOrderActionFlow';
import { OrderActionDialogs } from './OrderActionDialogs';

const COD: OrderActionTarget = {
  id: 'order-1',
  checkoutGroupId: 'group-1',
  status: 'PENDING',
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
};
const PAID_ONLINE: OrderActionTarget = {
  id: 'order-2',
  checkoutGroupId: 'group-2',
  status: 'PENDING',
  paymentMethod: 'VNPAY',
  paymentStatus: 'SUCCESS',
};
const UNPAID_ONLINE: OrderActionTarget = {
  id: 'order-3',
  checkoutGroupId: 'group-3',
  status: 'AWAITING_PAYMENT',
  paymentMethod: 'VNPAY',
  paymentStatus: 'PENDING',
};

function state(overrides: Partial<OrderActionDialogsState>): OrderActionDialogsState {
  return {
    dialog: null,
    isOpen: true,
    onOpenChange: vi.fn(),
    isCancelPending: false,
    isConfirmReceivedPending: false,
    isRequestRefundPending: false,
    isWithdrawRefundPending: false,
    isEscalateRefundPending: false,
    onCancel: vi.fn(),
    onConfirmReceived: vi.fn(),
    onRequestRefund: vi.fn(),
    onWithdrawRefund: vi.fn(),
    onEscalateRefund: vi.fn(),
    ...overrides,
  };
}

const renderDialogs = (overrides: Partial<OrderActionDialogsState>) =>
  render(withIntl(<OrderActionDialogs {...state(overrides)} />));

describe('OrderActionDialogs', () => {
  it('chưa có hộp thoại nào -> không render gì', () => {
    const { container } = renderDialogs({ dialog: null });

    expect(container).toBeEmptyDOMElement();
  });

  it('mỗi loại hộp thoại chỉ mở ĐÚNG hộp thoại của nó', () => {
    const cases: [NonNullable<OrderActionDialogsState['dialog']>, string][] = [
      [{ kind: 'cancel', order: COD }, 'Hủy đơn hàng này?'],
      [{ kind: 'confirmReceived', order: COD }, 'Xác nhận đã nhận hàng?'],
      [{ kind: 'requestRefund', order: COD, refundKind: 'CANCEL' }, 'Yêu cầu hủy đơn hàng'],
      [{ kind: 'requestRefund', order: COD, refundKind: 'RETURN' }, 'Yêu cầu trả hàng/hoàn tiền'],
      [{ kind: 'withdrawRefund', order: COD, requestId: 'r1' }, 'Rút yêu cầu này?'],
      [{ kind: 'escalateRefund', order: COD, requestId: 'r1' }, 'Khiếu nại lên sàn?'],
    ];

    for (const [dialog, title] of cases) {
      const { unmount } = renderDialogs({ dialog });
      expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
      expect(screen.getByText(title)).toBeInTheDocument();
      unmount();
    }
  });

  it('isOpen = false -> không hộp thoại nào hiện dù còn giữ dialog (hiệu ứng đóng)', () => {
    renderDialogs({ dialog: { kind: 'cancel', order: COD }, isOpen: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('hủy đơn ĐÃ THANH TOÁN ONLINE: nói tiền sẽ được hoàn về phương thức ban đầu', () => {
    renderDialogs({ dialog: { kind: 'cancel', order: PAID_ONLINE } });

    expect(
      screen.getByText('Tiền đã thanh toán sẽ được hoàn về phương thức thanh toán ban đầu.'),
    ).toBeInTheDocument();
  });

  it('hủy đơn COD hoặc đơn online CHƯA thanh toán: KHÔNG hứa hoàn tiền', () => {
    const { unmount } = renderDialogs({ dialog: { kind: 'cancel', order: COD } });
    expect(screen.queryByText(/hoàn về phương thức thanh toán ban đầu/)).not.toBeInTheDocument();
    unmount();

    renderDialogs({ dialog: { kind: 'cancel', order: UNPAID_ONLINE } });
    expect(screen.queryByText(/hoàn về phương thức thanh toán ban đầu/)).not.toBeInTheDocument();
    // Đơn chưa thanh toán thì hủy cả nhóm — vẫn nói rõ.
    expect(screen.getByText(/cùng lần đặt hàng/)).toBeInTheDocument();
  });
});
