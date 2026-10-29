import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import * as adminService from '../services/admin.service';
import type { AdminCancelShopOrdersResult } from '../types';
import { useCancelShopOrdersFlow } from './useCancelShopOrdersFlow';

vi.mock('../services/admin.service', () => ({ cancelShopOpenOrders: vi.fn() }));

const SHOP = { id: 'shop-1', name: 'Thời Trang Thảo' };
const REASON = 'Shop bị khoá, hủy đơn chưa giao.';

const result = (
  overrides: Partial<AdminCancelShopOrdersResult> = {},
): AdminCancelShopOrdersResult => ({
  cancelled: 0,
  failed: [],
  needsManualRefund: [],
  refundsPending: 0,
  remaining: 0,
  ...overrides,
});

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useCancelShopOrdersFlow(), { wrapper });
}

describe('useCancelShopOrdersFlow', () => {
  beforeEach(() => {
    vi.mocked(adminService.cancelShopOpenOrders).mockReset();
  });

  it('ban đầu: chưa có shop đích, hộp thoại đóng, không kết quả, không lỗi', () => {
    const { result: hook } = setup();

    expect(hook.current.dialogState).toMatchObject({
      target: null,
      isOpen: false,
      summary: null,
      error: null,
      isPending: false,
    });
    expect(hook.current.isPending).toBe(false);
  });

  it('open mở hộp thoại cho đúng shop và xoá kết quả/lỗi của lần trước', async () => {
    vi.mocked(adminService.cancelShopOpenOrders).mockRejectedValueOnce(new Error('network'));
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));
    await act(async () => hook.current.dialogState.onConfirm(REASON));
    expect(hook.current.dialogState.error).not.toBeNull();

    act(() => hook.current.open({ id: 'shop-2', name: 'Shop B' }));

    expect(hook.current.dialogState).toMatchObject({
      target: { id: 'shop-2', name: 'Shop B' },
      isOpen: true,
      summary: null,
      error: null,
    });
  });

  it('mở hộp thoại cho shop KHÁC không mang kết quả tích luỹ của shop trước sang (không cộng dồn giữa hai shop)', async () => {
    vi.mocked(adminService.cancelShopOpenOrders)
      .mockResolvedValueOnce(result({ cancelled: 20, remaining: 2 }))
      .mockResolvedValueOnce(result({ cancelled: 1, remaining: 0 }));
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));
    await act(async () => hook.current.dialogState.onConfirm(REASON));
    expect(hook.current.dialogState.summary).toMatchObject({ cancelled: 20 });

    act(() => hook.current.open({ id: 'shop-2', name: 'Shop B' }));
    expect(hook.current.dialogState.summary).toBeNull();
    await act(async () => hook.current.dialogState.onConfirm(REASON));

    expect(hook.current.dialogState.summary).toMatchObject({ cancelled: 1, remaining: 0 });
  });

  it('xác nhận gọi service với id shop + lý do, rồi có kết quả để hiện (hộp thoại KHÔNG tự đóng)', async () => {
    vi.mocked(adminService.cancelShopOpenOrders).mockResolvedValue(result({ cancelled: 5 }));
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));

    await act(async () => hook.current.dialogState.onConfirm(REASON));

    expect(adminService.cancelShopOpenOrders).toHaveBeenCalledWith('shop-1', { reason: REASON });
    expect(hook.current.dialogState.summary).toMatchObject({ cancelled: 5, remaining: 0 });
    expect(hook.current.dialogState.isOpen).toBe(true);
    expect(hook.current.dialogState.error).toBeNull();
  });

  it('còn đơn: onContinue gọi lại với CÙNG lý do và cộng dồn kết quả hai lần', async () => {
    vi.mocked(adminService.cancelShopOpenOrders)
      .mockResolvedValueOnce(result({ cancelled: 20, remaining: 3 }))
      .mockResolvedValueOnce(result({ cancelled: 3, remaining: 0 }));
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));
    await act(async () => hook.current.dialogState.onConfirm(REASON));

    await act(async () => hook.current.dialogState.onContinue());

    expect(adminService.cancelShopOpenOrders).toHaveBeenCalledTimes(2);
    expect(vi.mocked(adminService.cancelShopOpenOrders).mock.calls[1]).toEqual([
      'shop-1',
      { reason: REASON },
    ]);
    expect(hook.current.dialogState.summary).toMatchObject({ cancelled: 23, remaining: 0 });
  });

  it('chưa xác nhận lần nào thì onContinue không gọi API', async () => {
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));

    await act(async () => hook.current.dialogState.onContinue());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(adminService.cancelShopOpenOrders).not.toHaveBeenCalled();
    expect(hook.current.dialogState.error).toBeNull();
  });

  it('409 SHOP_NOT_SUSPENDED: lỗi đã dịch hiện trong hộp thoại, KHÔNG xoá kết quả lần trước, hộp thoại giữ mở', async () => {
    vi.mocked(adminService.cancelShopOpenOrders)
      .mockResolvedValueOnce(result({ cancelled: 20, remaining: 4 }))
      .mockRejectedValueOnce(new ApiError('x', 409, 'SHOP_NOT_SUSPENDED'));
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));
    await act(async () => hook.current.dialogState.onConfirm(REASON));

    await act(async () => hook.current.dialogState.onContinue());

    expect(hook.current.dialogState.error).toBe(
      'Chỉ hủy hàng loạt được khi shop đang bị khoá. Danh sách đã được làm mới.',
    );
    expect(hook.current.dialogState.summary).toMatchObject({ cancelled: 20, remaining: 4 });
    expect(hook.current.dialogState.isOpen).toBe(true);
  });

  it('lỗi không rõ (mất mạng...) -> thông báo chung, không lộ message gốc', async () => {
    vi.mocked(adminService.cancelShopOpenOrders).mockRejectedValue(new Error('boom: stack trace'));
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));

    await act(async () => hook.current.dialogState.onConfirm(REASON));

    expect(hook.current.dialogState.error).toBe('Không thực hiện được thao tác, vui lòng thử lại');
    expect(hook.current.dialogState.error).not.toContain('boom');
  });

  it('đang chạy thì KHÔNG cho đóng (Esc/bấm nền); xong rồi thì đóng được', async () => {
    let resolve: (value: AdminCancelShopOrdersResult) => void = () => undefined;
    vi.mocked(adminService.cancelShopOpenOrders).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result: hook } = setup();
    act(() => hook.current.open(SHOP));

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = Promise.resolve(hook.current.dialogState.onConfirm(REASON));
    });
    await vi.waitFor(() => expect(hook.current.dialogState.isPending).toBe(true));

    act(() => hook.current.dialogState.onOpenChange(false));
    expect(hook.current.dialogState.isOpen).toBe(true);
    expect(hook.current.isPending).toBe(true);

    await act(async () => {
      resolve(result({ cancelled: 1 }));
      await pending;
    });
    await vi.waitFor(() => expect(hook.current.dialogState.isPending).toBe(false));
    act(() => hook.current.dialogState.onOpenChange(false));
    expect(hook.current.dialogState.isOpen).toBe(false);
  });

  it('xác nhận khi chưa có shop đích -> không gọi API', async () => {
    const { result: hook } = setup();

    await act(async () => hook.current.dialogState.onConfirm(REASON));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(adminService.cancelShopOpenOrders).not.toHaveBeenCalled();
  });
});
