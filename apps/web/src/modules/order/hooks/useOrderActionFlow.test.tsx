import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as redirect from '../redirect-to-payment-gateway';
import * as orderService from '../services/order.service';
import { useOrderActionFlow, type OrderActionTarget } from './useOrderActionFlow';

vi.mock('../services/order.service', () => ({
  cancelOrder: vi.fn(),
  confirmReceived: vi.fn(),
  retryPayment: vi.fn(),
  requestRefund: vi.fn(),
  withdrawRefundRequest: vi.fn(),
  escalateRefundRequest: vi.fn(),
}));
vi.mock('../redirect-to-payment-gateway', () => ({
  redirectToPaymentGateway: vi.fn(),
}));

const ORDER: OrderActionTarget = {
  id: 'order-1',
  checkoutGroupId: 'group-1',
  status: 'PENDING',
  paymentMethod: 'COD',
  paymentStatus: 'PENDING',
};
const UNPAID: OrderActionTarget = {
  id: 'order-2',
  checkoutGroupId: 'group-2',
  status: 'AWAITING_PAYMENT',
  paymentMethod: 'VNPAY',
  paymentStatus: 'PENDING',
};
const CONFIRMED: OrderActionTarget = {
  id: 'order-3',
  checkoutGroupId: 'group-3',
  status: 'CONFIRMED',
  paymentMethod: 'VNPAY',
  paymentStatus: 'SUCCESS',
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useOrderActionFlow(), { wrapper });
}

const apiError = (status: number, code?: string) => new ApiError('x', status, code);

// Mutation của react-query chỉ gọi service sau vài microtask, nên khẳng định "KHÔNG gọi API" ngay sau `act` đồng bộ
// luôn đúng kể cả khi code có lỗi. Test phủ định phải chờ hết việc treo rồi mới khẳng định — và khẳng định cả không có
// lỗi giả (`actionError` null): một handler gọi khi chưa có hộp thoại không gọi API nhưng nổ TypeError bên trong và hiện
// thông báo lỗi chung.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('useOrderActionFlow', () => {
  beforeEach(() => {
    vi.mocked(orderService.cancelOrder).mockReset();
    vi.mocked(orderService.confirmReceived).mockReset();
    vi.mocked(orderService.retryPayment).mockReset();
    vi.mocked(orderService.requestRefund).mockReset();
    vi.mocked(orderService.withdrawRefundRequest).mockReset();
    vi.mocked(orderService.escalateRefundRequest).mockReset();
    vi.mocked(redirect.redirectToPaymentGateway).mockReset();
  });

  it('ban đầu: không hộp thoại nào mở, không lỗi, không hành động nào đang chạy', () => {
    const { result } = setup();

    expect(result.current.dialogs.dialog).toBeNull();
    expect(result.current.dialogs.isOpen).toBe(false);
    expect(result.current.actionError).toBeNull();
    expect(result.current.isActionPending).toBe(false);
  });

  describe('hủy đơn', () => {
    it('mở hộp thoại hủy cho đúng đơn', () => {
      const { result } = setup();

      act(() => result.current.openCancelDialog(UNPAID));

      expect(result.current.dialogs.isOpen).toBe(true);
      expect(result.current.dialogs.dialog).toEqual({ kind: 'cancel', order: UNPAID });
    });

    it('xác nhận kèm lý do -> gọi service đúng đơn + lý do, rồi đóng hộp thoại (vẫn giữ đơn để hiệu ứng đóng không đổi nội dung)', async () => {
      vi.mocked(orderService.cancelOrder).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));

      act(() => result.current.dialogs.onCancel('Đặt nhầm'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.cancelOrder).toHaveBeenCalledWith('order-1', { reason: 'Đặt nhầm' });
      expect(result.current.actionError).toBeNull();
      expect(result.current.dialogs.dialog).toEqual({ kind: 'cancel', order: ORDER });
    });

    it('không nhập lý do -> reason undefined', async () => {
      vi.mocked(orderService.cancelOrder).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));

      act(() => result.current.dialogs.onCancel(undefined));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.cancelOrder).toHaveBeenCalledWith('order-1', { reason: undefined });
    });

    it('409 ORDER_CANCEL_NOT_ALLOWED -> đóng hộp thoại và hiện lỗi đã dịch theo mã', async () => {
      vi.mocked(orderService.cancelOrder).mockRejectedValue(
        apiError(409, 'ORDER_CANCEL_NOT_ALLOWED'),
      );
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));

      act(() => result.current.dialogs.onCancel(undefined));

      await waitFor(() =>
        expect(result.current.actionError).toBe('Đơn hàng này hiện không thể hủy'),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
    });

    it('mất mạng (NETWORK_ERROR) -> hiện lỗi mất kết nối đã dịch', async () => {
      vi.mocked(orderService.cancelOrder).mockRejectedValue(apiError(0, 'NETWORK_ERROR'));
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));

      act(() => result.current.dialogs.onCancel(undefined));

      await waitFor(() =>
        expect(result.current.actionError).toBe('Mất kết nối mạng, vui lòng kiểm tra và thử lại'),
      );
    });

    it('lỗi không rõ (không phải ApiError, hoặc ApiError không có mã) -> thông báo chung, không lộ message gốc', async () => {
      vi.mocked(orderService.cancelOrder).mockRejectedValueOnce(new Error('boom: stack trace'));
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));
      act(() => result.current.dialogs.onCancel(undefined));
      await waitFor(() =>
        expect(result.current.actionError).toBe('Không thực hiện được thao tác, vui lòng thử lại'),
      );

      vi.mocked(orderService.cancelOrder).mockRejectedValueOnce(apiError(500));
      act(() => result.current.openCancelDialog(ORDER));
      act(() => result.current.dialogs.onCancel(undefined));
      await waitFor(() =>
        expect(result.current.actionError).toBe('Không thực hiện được thao tác, vui lòng thử lại'),
      );
      expect(result.current.actionError).not.toContain('boom');
    });

    it('chưa mở hộp thoại nào mà bị gọi onCancel -> không gọi API', () => {
      const { result } = setup();

      act(() => result.current.dialogs.onCancel('x'));

      expect(orderService.cancelOrder).not.toHaveBeenCalled();
    });
  });

  describe('đã nhận hàng', () => {
    it('xác nhận -> gọi service đúng đơn rồi đóng hộp thoại', async () => {
      vi.mocked(orderService.confirmReceived).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openConfirmReceivedDialog(ORDER));
      expect(result.current.dialogs.dialog).toEqual({ kind: 'confirmReceived', order: ORDER });

      act(() => result.current.dialogs.onConfirmReceived());

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.confirmReceived).toHaveBeenCalledWith('order-1');
      expect(result.current.actionError).toBeNull();
    });

    it('409 ORDER_ALREADY_CHANGED (vừa đổi ở nơi khác) -> đóng hộp thoại và hiện lỗi đã dịch', async () => {
      vi.mocked(orderService.confirmReceived).mockRejectedValue(
        apiError(409, 'ORDER_ALREADY_CHANGED'),
      );
      const { result } = setup();
      act(() => result.current.openConfirmReceivedDialog(ORDER));

      act(() => result.current.dialogs.onConfirmReceived());

      await waitFor(() =>
        expect(result.current.actionError).toBe(
          'Đơn hàng vừa được cập nhật, vui lòng tải lại trang',
        ),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
    });
  });

  describe('yêu cầu hủy / trả hàng', () => {
    it('mở hộp thoại gửi yêu cầu kèm loại (CANCEL = yêu cầu hủy, RETURN = trả hàng/hoàn tiền)', () => {
      const { result } = setup();

      act(() => result.current.openRequestRefundDialog(CONFIRMED, 'CANCEL'));
      expect(result.current.dialogs.isOpen).toBe(true);
      expect(result.current.dialogs.dialog).toEqual({
        kind: 'requestRefund',
        order: CONFIRMED,
        refundKind: 'CANCEL',
      });

      act(() => result.current.dialogs.onOpenChange(false));
      act(() => result.current.openRequestRefundDialog(CONFIRMED, 'RETURN'));
      expect(result.current.dialogs.dialog?.refundKind).toBe('RETURN');
    });

    it('gửi yêu cầu -> gọi service đúng đơn + lý do/mô tả (KHÔNG gửi loại yêu cầu — BE tự suy), rồi đóng hộp thoại', async () => {
      vi.mocked(orderService.requestRefund).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openRequestRefundDialog(CONFIRMED, 'CANCEL'));

      act(() =>
        result.current.dialogs.onRequestRefund({
          reasonCode: 'CHANGE_OF_MIND',
          reasonNote: 'Đổi ý',
        }),
      );

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.requestRefund).toHaveBeenCalledWith('order-3', {
        reasonCode: 'CHANGE_OF_MIND',
        reasonNote: 'Đổi ý',
      });
      expect(result.current.actionError).toBeNull();
    });

    it('409 REFUND_REQUEST_NOT_ALLOWED: câu lỗi THEO details.reason (quá hạn / đã có yêu cầu / sai trạng thái / chưa thu tiền)', async () => {
      const cases = [
        ['WINDOW_EXPIRED', 'Đã quá thời hạn để thực hiện thao tác này'],
        ['ALREADY_REQUESTED', 'Đơn hàng này đã có yêu cầu đang được xử lý'],
        ['NOT_ELIGIBLE_STATUS', 'Đơn hàng hiện không ở trạng thái gửi được yêu cầu này'],
        [
          'PAYMENT_NOT_COLLECTED',
          'Đơn hàng này chưa ghi nhận thanh toán thành công nên chưa gửi được yêu cầu',
        ],
      ] as const;
      for (const [reason, expected] of cases) {
        vi.mocked(orderService.requestRefund).mockRejectedValueOnce(
          new ApiError('x', 409, 'REFUND_REQUEST_NOT_ALLOWED', { reason }),
        );
        const { result } = setup();
        act(() => result.current.openRequestRefundDialog(CONFIRMED, 'RETURN'));

        act(() => result.current.dialogs.onRequestRefund({ reasonCode: 'DAMAGED' }));

        await waitFor(() => expect(result.current.actionError).toBe(expected));
        expect(result.current.dialogs.isOpen).toBe(false);
      }
    });

    it('REFUND_REQUEST_NOT_ALLOWED thiếu/sai details -> câu chung của mã, không vỡ', async () => {
      vi.mocked(orderService.requestRefund).mockRejectedValueOnce(
        new ApiError('x', 409, 'REFUND_REQUEST_NOT_ALLOWED', { reason: 'SOMETHING_NEW' }),
      );
      const { result } = setup();
      act(() => result.current.openRequestRefundDialog(CONFIRMED, 'CANCEL'));
      act(() => result.current.dialogs.onRequestRefund({ reasonCode: 'OTHER', reasonNote: 'x' }));

      await waitFor(() =>
        expect(result.current.actionError).toBe(
          'Đơn hàng này hiện không gửi được yêu cầu hủy hoặc hoàn tiền',
        ),
      );
    });

    it('rút yêu cầu: mở hộp thoại với requestId, xác nhận gọi service đúng yêu cầu rồi đóng', async () => {
      vi.mocked(orderService.withdrawRefundRequest).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openWithdrawRefundDialog(CONFIRMED, 'request-1'));
      expect(result.current.dialogs.dialog).toEqual({
        kind: 'withdrawRefund',
        order: CONFIRMED,
        requestId: 'request-1',
      });

      act(() => result.current.dialogs.onWithdrawRefund());

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.withdrawRefundRequest).toHaveBeenCalledWith('request-1');
    });

    it('rút khi seller vừa trả lời (409 REFUND_REQUEST_INVALID_TRANSITION) -> hiện lỗi đã dịch và đóng hộp thoại', async () => {
      vi.mocked(orderService.withdrawRefundRequest).mockRejectedValue(
        apiError(409, 'REFUND_REQUEST_INVALID_TRANSITION'),
      );
      const { result } = setup();
      act(() => result.current.openWithdrawRefundDialog(CONFIRMED, 'request-1'));

      act(() => result.current.dialogs.onWithdrawRefund());

      await waitFor(() =>
        expect(result.current.actionError).toBe(
          'Yêu cầu vừa được cập nhật, vui lòng tải lại trang',
        ),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
    });

    it('khiếu nại: xác nhận gọi service đúng yêu cầu; quá hạn (WINDOW_EXPIRED) -> câu "đã quá thời hạn"', async () => {
      vi.mocked(orderService.escalateRefundRequest).mockResolvedValueOnce({} as never);
      const { result } = setup();
      act(() => result.current.openEscalateRefundDialog(CONFIRMED, 'request-9'));
      expect(result.current.dialogs.dialog?.kind).toBe('escalateRefund');

      act(() => result.current.dialogs.onEscalateRefund());
      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.escalateRefundRequest).toHaveBeenCalledWith('request-9');

      vi.mocked(orderService.escalateRefundRequest).mockRejectedValueOnce(
        new ApiError('x', 409, 'REFUND_REQUEST_NOT_ALLOWED', { reason: 'WINDOW_EXPIRED' }),
      );
      act(() => result.current.openEscalateRefundDialog(CONFIRMED, 'request-9'));
      act(() => result.current.dialogs.onEscalateRefund());
      await waitFor(() =>
        expect(result.current.actionError).toBe('Đã quá thời hạn để thực hiện thao tác này'),
      );
    });

    it('rút/khiếu nại mà hộp thoại không mang requestId -> không gọi API', () => {
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));

      act(() => result.current.dialogs.onWithdrawRefund());
      act(() => result.current.dialogs.onEscalateRefund());

      expect(orderService.withdrawRefundRequest).not.toHaveBeenCalled();
      expect(orderService.escalateRefundRequest).not.toHaveBeenCalled();
    });

    it('đang gửi yêu cầu: khoá mọi hành động, không đóng được hộp thoại, cờ pending riêng bật', async () => {
      let resolveRequest: (value: never) => void = () => undefined;
      vi.mocked(orderService.requestRefund).mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve as (value: never) => void;
        }),
      );
      const { result } = setup();
      act(() => result.current.openRequestRefundDialog(CONFIRMED, 'CANCEL'));
      act(() => result.current.dialogs.onRequestRefund({ reasonCode: 'CHANGE_OF_MIND' }));
      await waitFor(() => expect(result.current.isActionPending).toBe(true));

      act(() => result.current.dialogs.onOpenChange(false));
      expect(result.current.dialogs.isOpen).toBe(true);
      expect(result.current.dialogs.isRequestRefundPending).toBe(true);
      expect(result.current.dialogs.isWithdrawRefundPending).toBe(false);

      await act(async () => resolveRequest({} as never));
      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
    });
  });

  describe('thanh toán lại', () => {
    it('gọi service theo checkoutGroupId (không phải id đơn) rồi chuyển sang cổng, và giữ nút khoá tới khi rời trang', async () => {
      vi.mocked(orderService.retryPayment).mockResolvedValue({
        paymentUrl: 'https://pay.example/x',
        expiresAt: '2026-10-03T10:00:00.000Z',
      });
      const { result } = setup();

      await act(() => result.current.retryPayment(UNPAID));

      expect(orderService.retryPayment).toHaveBeenCalledWith('group-2');
      expect(redirect.redirectToPaymentGateway).toHaveBeenCalledWith('https://pay.example/x');
      expect(result.current.isActionPending).toBe(true);
    });

    it('lỗi (vd 409 hết hạn giữ chỗ) -> hiện lỗi đã dịch, KHÔNG chuyển trang, nút mở khoá lại', async () => {
      vi.mocked(orderService.retryPayment).mockRejectedValue(
        apiError(409, 'PAYMENT_RETRY_NOT_ALLOWED'),
      );
      const { result } = setup();

      await act(() => result.current.retryPayment(UNPAID));

      expect(result.current.actionError).toBeTruthy();
      expect(result.current.actionError).not.toBe(
        'Không thực hiện được thao tác, vui lòng thử lại',
      );
      expect(redirect.redirectToPaymentGateway).not.toHaveBeenCalled();
      expect(result.current.isActionPending).toBe(false);
    });
  });

  it('mở hộp thoại mới xoá lỗi của hành động trước', async () => {
    vi.mocked(orderService.cancelOrder).mockRejectedValue(
      apiError(409, 'ORDER_CANCEL_NOT_ALLOWED'),
    );
    const { result } = setup();
    act(() => result.current.openCancelDialog(ORDER));
    act(() => result.current.dialogs.onCancel(undefined));
    await waitFor(() => expect(result.current.actionError).not.toBeNull());

    act(() => result.current.openConfirmReceivedDialog(ORDER));

    expect(result.current.actionError).toBeNull();
  });

  describe('đóng hộp thoại', () => {
    it('đang rảnh -> đóng được (Esc/bấm nền/nút Quay lại)', () => {
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));

      act(() => result.current.dialogs.onOpenChange(false));

      expect(result.current.dialogs.isOpen).toBe(false);
    });

    it('đang gửi yêu cầu -> bỏ qua yêu cầu đóng (hộp thoại tự đóng khi xong), và khoá mọi hành động', async () => {
      let resolveCancel: (value: never) => void = () => undefined;
      vi.mocked(orderService.cancelOrder).mockReturnValue(
        new Promise((resolve) => {
          resolveCancel = resolve as (value: never) => void;
        }),
      );
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));
      act(() => result.current.dialogs.onCancel(undefined));
      await waitFor(() => expect(result.current.isActionPending).toBe(true));

      act(() => result.current.dialogs.onOpenChange(false));
      expect(result.current.dialogs.isOpen).toBe(true);
      expect(result.current.dialogs.isCancelPending).toBe(true);

      await act(async () => resolveCancel({} as never));
      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(result.current.isActionPending).toBe(false);
    });
  });

  describe('handler của hộp thoại khi KHÔNG có hộp thoại tương ứng đang mở', () => {
    it('chưa mở hộp thoại nào -> mọi handler là no-op: không gọi API, không hiện lỗi giả', async () => {
      const { result } = setup();

      act(() => result.current.dialogs.onCancel('x'));
      act(() => result.current.dialogs.onConfirmReceived());
      act(() => result.current.dialogs.onRequestRefund({ reasonCode: 'CHANGE_OF_MIND' }));
      act(() => result.current.dialogs.onWithdrawRefund());
      act(() => result.current.dialogs.onEscalateRefund());
      await settle();

      expect(orderService.cancelOrder).not.toHaveBeenCalled();
      expect(orderService.confirmReceived).not.toHaveBeenCalled();
      expect(orderService.requestRefund).not.toHaveBeenCalled();
      expect(orderService.withdrawRefundRequest).not.toHaveBeenCalled();
      expect(orderService.escalateRefundRequest).not.toHaveBeenCalled();
      expect(result.current.actionError).toBeNull();
    });

    it('đang mở hộp thoại hủy/đã nhận hàng (không có requestId) -> onWithdrawRefund/onEscalateRefund là no-op', async () => {
      const { result } = setup();
      act(() => result.current.openCancelDialog(ORDER));

      act(() => result.current.dialogs.onWithdrawRefund());
      act(() => result.current.dialogs.onEscalateRefund());
      await settle();

      expect(orderService.withdrawRefundRequest).not.toHaveBeenCalled();
      expect(orderService.escalateRefundRequest).not.toHaveBeenCalled();
      expect(result.current.actionError).toBeNull();
    });
  });
});
