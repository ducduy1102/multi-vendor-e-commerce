import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as adminService from '../services/admin.service';
import { useAdminShopActionFlow, type AdminShopActionTarget } from './useAdminShopActionFlow';

vi.mock('../services/admin.service', () => ({
  updateShopStatus: vi.fn(),
}));

const SHOP: AdminShopActionTarget = { id: 'shop-1', name: 'Shop A' };

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useAdminShopActionFlow(), { wrapper });
}

const apiError = (status: number, code?: string) => new ApiError('x', status, code);

describe('useAdminShopActionFlow', () => {
  beforeEach(() => {
    vi.mocked(adminService.updateShopStatus).mockReset();
  });

  it('ban đầu: không hộp thoại nào mở, không lỗi, không hành động nào đang chạy', () => {
    const { result } = setup();

    expect(result.current.dialogs.dialog).toBeNull();
    expect(result.current.dialogs.isOpen).toBe(false);
    expect(result.current.actionError).toBeNull();
    expect(result.current.isActionPending).toBe(false);
  });

  describe('duyệt (chạy ngay, không hộp thoại)', () => {
    it('gọi service đặt APPROVED, không mở hộp thoại, không lỗi', async () => {
      vi.mocked(adminService.updateShopStatus).mockResolvedValue({} as never);
      const { result } = setup();

      await act(() => result.current.approve(SHOP));

      expect(adminService.updateShopStatus).toHaveBeenCalledWith('shop-1', { status: 'APPROVED' });
      expect(result.current.dialogs.dialog).toBeNull();
      expect(result.current.actionError).toBeNull();
    });

    it('409 SHOP_INVALID_TRANSITION (Admin khác vừa xử lý) -> lỗi đã dịch, KHÔNG ném ra ngoài', async () => {
      vi.mocked(adminService.updateShopStatus).mockRejectedValue(
        apiError(409, 'SHOP_INVALID_TRANSITION'),
      );
      const { result } = setup();

      await act(() => result.current.approve(SHOP));

      expect(result.current.actionError).toBe(
        'Trạng thái shop vừa thay đổi nên thao tác này không còn hợp lệ. Dữ liệu đã được làm mới, vui lòng kiểm tra lại.',
      );
    });

    it('lỗi không rõ (mất mạng, 403...) -> thông báo chung, không lộ message gốc', async () => {
      vi.mocked(adminService.updateShopStatus).mockRejectedValue(new Error('boom: stack trace'));
      const { result } = setup();

      await act(() => result.current.approve(SHOP));

      expect(result.current.actionError).toBe('Không thực hiện được thao tác, vui lòng thử lại');
      expect(result.current.actionError).not.toContain('boom');
    });

    it('hành động tiếp theo xoá lỗi của hành động trước', async () => {
      vi.mocked(adminService.updateShopStatus)
        .mockRejectedValueOnce(apiError(409, 'SHOP_INVALID_TRANSITION'))
        .mockResolvedValue({} as never);
      const { result } = setup();
      await act(() => result.current.approve(SHOP));
      expect(result.current.actionError).not.toBeNull();

      await act(() => result.current.approve({ id: 'shop-2', name: 'Shop B' }));

      expect(result.current.actionError).toBeNull();
    });
  });

  describe.each([
    ['reject', 'REJECTED', 'openRejectDialog'],
    ['suspend', 'SUSPENDED', 'openSuspendDialog'],
  ] as const)('%s (cần lý do)', (kind, status, openName) => {
    it('mở hộp thoại cho đúng shop và đúng loại', () => {
      const { result } = setup();

      act(() => result.current[openName](SHOP));

      expect(result.current.dialogs.isOpen).toBe(true);
      expect(result.current.dialogs.dialog).toEqual({ kind, shop: SHOP });
    });

    it(`xác nhận -> gọi service đặt ${status} kèm lý do, rồi đóng hộp thoại`, async () => {
      vi.mocked(adminService.updateShopStatus).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current[openName](SHOP));

      act(() => result.current.dialogs.onConfirmReason('Hàng cấm'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.updateShopStatus).toHaveBeenCalledWith('shop-1', {
        status,
        reason: 'Hàng cấm',
      });
      expect(result.current.actionError).toBeNull();
    });

    it('lỗi 409 -> hộp thoại vẫn đóng, lỗi đã dịch hiện ở trang (danh sách đã cũ, người dùng cần thấy)', async () => {
      vi.mocked(adminService.updateShopStatus).mockRejectedValue(
        apiError(409, 'SHOP_INVALID_TRANSITION'),
      );
      const { result } = setup();
      act(() => result.current[openName](SHOP));

      act(() => result.current.dialogs.onConfirmReason('Hàng cấm'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(result.current.actionError).toBe(
        'Trạng thái shop vừa thay đổi nên thao tác này không còn hợp lệ. Dữ liệu đã được làm mới, vui lòng kiểm tra lại.',
      );
    });

    it('mở lại hộp thoại xoá lỗi cũ', async () => {
      vi.mocked(adminService.updateShopStatus).mockRejectedValue(new Error('x'));
      const { result } = setup();
      act(() => result.current[openName](SHOP));
      act(() => result.current.dialogs.onConfirmReason('a'));
      await waitFor(() => expect(result.current.actionError).not.toBeNull());

      act(() => result.current[openName](SHOP));

      expect(result.current.actionError).toBeNull();
    });
  });

  describe('mở khoá (xác nhận nhẹ, không lý do)', () => {
    it('mở hộp thoại, xác nhận -> đặt APPROVED KHÔNG kèm lý do, rồi đóng', async () => {
      vi.mocked(adminService.updateShopStatus).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openUnsuspendDialog(SHOP));
      expect(result.current.dialogs.dialog).toEqual({ kind: 'unsuspend', shop: SHOP });

      act(() => result.current.dialogs.onConfirmUnsuspend());

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.updateShopStatus).toHaveBeenCalledWith('shop-1', { status: 'APPROVED' });
    });
  });

  it('onConfirmReason khi hộp thoại đang là "mở khoá" -> không gọi service (không có lý do để gửi)', () => {
    const { result } = setup();
    act(() => result.current.openUnsuspendDialog(SHOP));

    act(() => result.current.dialogs.onConfirmReason('x'));

    expect(adminService.updateShopStatus).not.toHaveBeenCalled();
  });

  it('chưa mở hộp thoại nào mà gọi xác nhận -> không làm gì', () => {
    const { result } = setup();

    act(() => result.current.dialogs.onConfirmReason('x'));
    act(() => result.current.dialogs.onConfirmUnsuspend());

    expect(adminService.updateShopStatus).not.toHaveBeenCalled();
  });

  it('đang gửi yêu cầu thì không cho đóng hộp thoại (Esc/bấm nền), isActionPending bật', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(adminService.updateShopStatus).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as never,
    );
    const { result } = setup();
    act(() => result.current.openRejectDialog(SHOP));
    act(() => result.current.dialogs.onConfirmReason('x'));
    await waitFor(() => expect(result.current.isActionPending).toBe(true));

    act(() => result.current.dialogs.onOpenChange(false));
    expect(result.current.dialogs.isOpen).toBe(true);

    await act(async () => {
      resolve({});
    });
    await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
  });
});
