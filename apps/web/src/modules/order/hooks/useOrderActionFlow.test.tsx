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
}));
vi.mock('../redirect-to-payment-gateway', () => ({
  redirectToPaymentGateway: vi.fn(),
}));

const ORDER: OrderActionTarget = { id: 'order-1', checkoutGroupId: 'group-1', status: 'PENDING' };
const UNPAID: OrderActionTarget = {
  id: 'order-2',
  checkoutGroupId: 'group-2',
  status: 'AWAITING_PAYMENT',
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useOrderActionFlow(), { wrapper });
}

const apiError = (status: number, code?: string) => new ApiError('x', status, code);

describe('useOrderActionFlow', () => {
  beforeEach(() => {
    vi.mocked(orderService.cancelOrder).mockReset();
    vi.mocked(orderService.confirmReceived).mockReset();
    vi.mocked(orderService.retryPayment).mockReset();
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
});
