import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as orderService from '../services/order.service';
import { useSellerOrderActionFlow, type SellerOrderActionTarget } from './useSellerOrderActionFlow';

vi.mock('../services/order.service', () => ({
  confirmOrder: vi.fn(),
  packOrder: vi.fn(),
  shipOrder: vi.fn(),
  rejectOrder: vi.fn(),
}));

const ORDER: SellerOrderActionTarget = { id: 'order-1' };
const SHOP = 'shop-1';

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useSellerOrderActionFlow(SHOP), { wrapper });
}

const apiError = (status: number, code?: string) => new ApiError('x', status, code);

describe('useSellerOrderActionFlow', () => {
  beforeEach(() => {
    vi.mocked(orderService.confirmOrder).mockReset();
    vi.mocked(orderService.packOrder).mockReset();
    vi.mocked(orderService.shipOrder).mockReset();
    vi.mocked(orderService.rejectOrder).mockReset();
  });

  it('ban đầu: không hộp thoại nào mở, không lỗi, không hành động nào đang chạy', () => {
    const { result } = setup();

    expect(result.current.dialogs.dialog).toBeNull();
    expect(result.current.dialogs.isOpen).toBe(false);
    expect(result.current.actionError).toBeNull();
    expect(result.current.isActionPending).toBe(false);
  });

  describe('xác nhận / đóng gói (chạy ngay, không hộp thoại)', () => {
    it('xác nhận -> gọi service theo shopId + orderId, không mở hộp thoại, không lỗi', async () => {
      vi.mocked(orderService.confirmOrder).mockResolvedValue({} as never);
      const { result } = setup();

      await act(() => result.current.confirm(ORDER));

      expect(orderService.confirmOrder).toHaveBeenCalledWith(SHOP, 'order-1');
      expect(result.current.dialogs.dialog).toBeNull();
      expect(result.current.actionError).toBeNull();
    });

    it('đóng gói -> gọi service theo shopId + orderId', async () => {
      vi.mocked(orderService.packOrder).mockResolvedValue({} as never);
      const { result } = setup();

      await act(() => result.current.pack(ORDER));

      expect(orderService.packOrder).toHaveBeenCalledWith(SHOP, 'order-1');
      expect(result.current.actionError).toBeNull();
    });

    it('409 ORDER_ALREADY_CHANGED (người mua vừa hủy) -> hiện lỗi đã dịch, KHÔNG ném ra ngoài', async () => {
      vi.mocked(orderService.confirmOrder).mockRejectedValue(
        apiError(409, 'ORDER_ALREADY_CHANGED'),
      );
      const { result } = setup();

      await act(() => result.current.confirm(ORDER));

      expect(result.current.actionError).toBe('Đơn hàng vừa được cập nhật, vui lòng tải lại trang');
    });

    it('409 ORDER_INVALID_TRANSITION (sai thứ tự) -> lỗi đã dịch theo mã', async () => {
      vi.mocked(orderService.packOrder).mockRejectedValue(
        apiError(409, 'ORDER_INVALID_TRANSITION'),
      );
      const { result } = setup();

      await act(() => result.current.pack(ORDER));

      expect(result.current.actionError).toBe(
        'Không thể thực hiện thao tác này ở trạng thái hiện tại của đơn hàng',
      );
    });

    it('lỗi không rõ -> thông báo chung, không lộ message gốc', async () => {
      vi.mocked(orderService.confirmOrder).mockRejectedValue(new Error('boom: stack trace'));
      const { result } = setup();

      await act(() => result.current.confirm(ORDER));

      expect(result.current.actionError).toBe('Không thực hiện được thao tác, vui lòng thử lại');
      expect(result.current.actionError).not.toContain('boom');
    });

    it('hành động tiếp theo xoá lỗi của hành động trước', async () => {
      vi.mocked(orderService.confirmOrder).mockRejectedValueOnce(
        apiError(409, 'ORDER_ALREADY_CHANGED'),
      );
      vi.mocked(orderService.packOrder).mockResolvedValue({} as never);
      const { result } = setup();
      await act(() => result.current.confirm(ORDER));
      expect(result.current.actionError).not.toBeNull();

      await act(() => result.current.pack({ id: 'order-2' }));

      expect(result.current.actionError).toBeNull();
    });
  });

  describe('giao hàng', () => {
    it('mở hộp thoại giao cho đúng đơn', () => {
      const { result } = setup();

      act(() => result.current.openShipDialog(ORDER));

      expect(result.current.dialogs.isOpen).toBe(true);
      expect(result.current.dialogs.dialog).toEqual({ kind: 'ship', order: ORDER });
    });

    it('xác nhận -> gọi service kèm đơn vị vận chuyển + mã vận đơn, rồi đóng hộp thoại', async () => {
      vi.mocked(orderService.shipOrder).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openShipDialog(ORDER));

      act(() => result.current.dialogs.onShip({ carrier: 'GHN', trackingCode: 'GHN123' }));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.shipOrder).toHaveBeenCalledWith(SHOP, 'order-1', {
        carrier: 'GHN',
        trackingCode: 'GHN123',
      });
      expect(result.current.actionError).toBeNull();
    });

    it('shop tự giao (để trống cả hai) -> vẫn gọi service với 2 trường undefined', async () => {
      vi.mocked(orderService.shipOrder).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openShipDialog(ORDER));

      act(() => result.current.dialogs.onShip({ carrier: undefined, trackingCode: undefined }));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.shipOrder).toHaveBeenCalledWith(SHOP, 'order-1', {
        carrier: undefined,
        trackingCode: undefined,
      });
    });

    it('lỗi -> đóng hộp thoại và hiện lỗi đã dịch theo mã', async () => {
      vi.mocked(orderService.shipOrder).mockRejectedValue(apiError(409, 'ORDER_ALREADY_CHANGED'));
      const { result } = setup();
      act(() => result.current.openShipDialog(ORDER));

      act(() => result.current.dialogs.onShip({ carrier: undefined, trackingCode: undefined }));

      await waitFor(() =>
        expect(result.current.actionError).toBe(
          'Đơn hàng vừa được cập nhật, vui lòng tải lại trang',
        ),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
    });

    it('chưa mở hộp thoại nào mà bị gọi onShip -> không gọi API', () => {
      const { result } = setup();

      act(() => result.current.dialogs.onShip({ carrier: 'x', trackingCode: 'y' }));

      expect(orderService.shipOrder).not.toHaveBeenCalled();
    });
  });

  describe('từ chối', () => {
    it('mở hộp thoại từ chối cho đúng đơn', () => {
      const { result } = setup();

      act(() => result.current.openRejectDialog(ORDER));

      expect(result.current.dialogs.dialog).toEqual({ kind: 'reject', order: ORDER });
    });

    it('xác nhận kèm lý do -> gọi service đúng đơn + lý do rồi đóng hộp thoại', async () => {
      vi.mocked(orderService.rejectOrder).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openRejectDialog(ORDER));

      act(() => result.current.dialogs.onReject('Hết hàng'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(orderService.rejectOrder).toHaveBeenCalledWith(SHOP, 'order-1', {
        reason: 'Hết hàng',
      });
      expect(result.current.actionError).toBeNull();
    });

    it('409 ORDER_CANCEL_NOT_ALLOWED (đơn đã trả online) -> đóng hộp thoại, hiện lỗi đã dịch', async () => {
      vi.mocked(orderService.rejectOrder).mockRejectedValue(
        apiError(409, 'ORDER_CANCEL_NOT_ALLOWED'),
      );
      const { result } = setup();
      act(() => result.current.openRejectDialog(ORDER));

      act(() => result.current.dialogs.onReject('x'));

      await waitFor(() =>
        expect(result.current.actionError).toBe('Đơn hàng này hiện không thể hủy'),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
    });

    it('chưa mở hộp thoại nào mà bị gọi onReject -> không gọi API', () => {
      const { result } = setup();

      act(() => result.current.dialogs.onReject('x'));

      expect(orderService.rejectOrder).not.toHaveBeenCalled();
    });
  });

  it('mở hộp thoại mới xoá lỗi của hành động trước', async () => {
    vi.mocked(orderService.confirmOrder).mockRejectedValue(apiError(409, 'ORDER_ALREADY_CHANGED'));
    const { result } = setup();
    await act(() => result.current.confirm(ORDER));
    expect(result.current.actionError).not.toBeNull();

    act(() => result.current.openRejectDialog(ORDER));

    expect(result.current.actionError).toBeNull();
  });

  describe('đóng hộp thoại', () => {
    it('đang rảnh -> đóng được (Esc/bấm nền/nút Quay lại)', () => {
      const { result } = setup();
      act(() => result.current.openShipDialog(ORDER));

      act(() => result.current.dialogs.onOpenChange(false));

      expect(result.current.dialogs.isOpen).toBe(false);
    });

    it('đang gửi yêu cầu -> bỏ qua yêu cầu đóng, khoá mọi hành động, tự đóng khi xong', async () => {
      let resolveShip: (value: never) => void = () => undefined;
      vi.mocked(orderService.shipOrder).mockReturnValue(
        new Promise((resolve) => {
          resolveShip = resolve as (value: never) => void;
        }),
      );
      const { result } = setup();
      act(() => result.current.openShipDialog(ORDER));
      act(() => result.current.dialogs.onShip({ carrier: undefined, trackingCode: undefined }));
      await waitFor(() => expect(result.current.isActionPending).toBe(true));

      act(() => result.current.dialogs.onOpenChange(false));
      expect(result.current.dialogs.isOpen).toBe(true);
      expect(result.current.dialogs.isShipPending).toBe(true);

      await act(async () => resolveShip({} as never));
      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(result.current.isActionPending).toBe(false);
    });

    it('xác nhận/đóng gói đang chạy cũng khoá mọi nút (isActionPending) để không gửi chồng', async () => {
      let resolveConfirm: (value: never) => void = () => undefined;
      vi.mocked(orderService.confirmOrder).mockReturnValue(
        new Promise((resolve) => {
          resolveConfirm = resolve as (value: never) => void;
        }),
      );
      const { result } = setup();

      act(() => void result.current.confirm(ORDER));
      await waitFor(() => expect(result.current.isActionPending).toBe(true));

      await act(async () => resolveConfirm({} as never));
      await waitFor(() => expect(result.current.isActionPending).toBe(false));
    });
  });
});
