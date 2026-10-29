import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { makeAppeal } from '../admin-appeal.fixtures';
import * as adminService from '../services/admin.service';
import {
  toAdminAppealActionTarget,
  useAdminAppealActionFlow,
  type AdminAppealActionTarget,
} from './useAdminAppealActionFlow';

vi.mock('../services/admin.service', () => ({
  decideAppeal: vi.fn(),
}));

const APPEAL: AdminAppealActionTarget = {
  id: 'appeal-1',
  shopName: 'Shop A',
  suspensionReason: 'Bán hàng giả',
  message: 'Xin xem xét lại',
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useAdminAppealActionFlow(), { wrapper });
}

const apiError = (status: number, code?: string) => new ApiError('x', status, code);

describe('toAdminAppealActionTarget', () => {
  it('chỉ lấy những gì hộp thoại cần: id, tên shop, lý do khoá, lời kháng nghị — không email chủ shop', () => {
    expect(toAdminAppealActionTarget(makeAppeal())).toEqual({
      id: 'a1b2c3d4-1234-4a5b-8c9d-abcdef000001',
      shopName: 'Shop Thời Trang ABC',
      suspensionReason: 'Bán hàng giả',
      message: 'Shop đã gỡ các sản phẩm bị báo cáo và bổ sung giấy tờ nguồn gốc.',
    });
  });
});

describe('useAdminAppealActionFlow', () => {
  beforeEach(() => {
    vi.mocked(adminService.decideAppeal).mockReset();
  });

  it('ban đầu: không hộp thoại nào mở, không lỗi, không hành động nào đang chạy', () => {
    const { result } = setup();

    expect(result.current.dialogs.dialog).toBeNull();
    expect(result.current.dialogs.isOpen).toBe(false);
    expect(result.current.actionError).toBeNull();
    expect(result.current.isActionPending).toBe(false);
  });

  it('chấp nhận KHÔNG chạy ngay: mở hộp thoại để Admin đọc đủ lời kháng nghị trước, chưa gọi service', () => {
    const { result } = setup();

    act(() => result.current.openAcceptDialog(APPEAL));

    expect(result.current.dialogs.isOpen).toBe(true);
    expect(result.current.dialogs.dialog).toEqual({ kind: 'accept', appeal: APPEAL });
    expect(adminService.decideAppeal).not.toHaveBeenCalled();
  });

  it('từ chối cũng mở hộp thoại (ghi chú bắt buộc nhập ở form)', () => {
    const { result } = setup();

    act(() => result.current.openRejectDialog(APPEAL));

    expect(result.current.dialogs.dialog).toEqual({ kind: 'reject', appeal: APPEAL });
  });

  it('xác nhận chấp nhận không ghi chú: gọi service ACCEPT không kèm note, rồi đóng hộp thoại', async () => {
    vi.mocked(adminService.decideAppeal).mockResolvedValue(makeAppeal());
    const { result } = setup();
    act(() => result.current.openAcceptDialog(APPEAL));

    await act(async () => {
      result.current.dialogs.onConfirm(undefined);
    });

    expect(adminService.decideAppeal).toHaveBeenCalledWith('appeal-1', { decision: 'ACCEPT' });
    expect(result.current.dialogs.isOpen).toBe(false);
    expect(result.current.actionError).toBeNull();
  });

  it('xác nhận từ chối kèm ghi chú: gọi service REJECT với đúng ghi chú', async () => {
    vi.mocked(adminService.decideAppeal).mockResolvedValue(makeAppeal());
    const { result } = setup();
    act(() => result.current.openRejectDialog(APPEAL));

    await act(async () => {
      result.current.dialogs.onConfirm('Giấy tờ chưa hợp lệ');
    });

    expect(adminService.decideAppeal).toHaveBeenCalledWith('appeal-1', {
      decision: 'REJECT',
      note: 'Giấy tờ chưa hợp lệ',
    });
  });

  it('409 APPEAL_ALREADY_DECIDED (Admin khác vừa quyết định) -> lỗi đã dịch, hộp thoại đóng, KHÔNG ném ra ngoài', async () => {
    vi.mocked(adminService.decideAppeal).mockRejectedValue(apiError(409, 'APPEAL_ALREADY_DECIDED'));
    const { result } = setup();
    act(() => result.current.openAcceptDialog(APPEAL));

    await act(async () => {
      result.current.dialogs.onConfirm(undefined);
    });

    expect(result.current.actionError).toBe(
      'Kháng nghị này đã được Admin khác xử lý. Danh sách đã được làm mới.',
    );
    expect(result.current.dialogs.isOpen).toBe(false);
  });

  it('409 APPEAL_TARGET_CHANGED -> câu giải thích lần khoá đã kết thúc', async () => {
    vi.mocked(adminService.decideAppeal).mockRejectedValue(apiError(409, 'APPEAL_TARGET_CHANGED'));
    const { result } = setup();
    act(() => result.current.openRejectDialog(APPEAL));

    await act(async () => {
      result.current.dialogs.onConfirm('Lý do');
    });

    expect(result.current.actionError).toContain('đã kết thúc');
  });

  it('409 SHOP_OWNER_NOT_ACTIVE (chấp nhận nhưng chủ shop đang bị khoá tài khoản) -> dùng câu của bảng mã lỗi chung', async () => {
    vi.mocked(adminService.decideAppeal).mockRejectedValue(apiError(409, 'SHOP_OWNER_NOT_ACTIVE'));
    const { result } = setup();
    act(() => result.current.openAcceptDialog(APPEAL));

    await act(async () => {
      result.current.dialogs.onConfirm(undefined);
    });

    expect(result.current.actionError).not.toBeNull();
    expect(result.current.actionError).not.toBe('SHOP_OWNER_NOT_ACTIVE');
  });

  it('lỗi không rõ (mất mạng, 500) -> thông báo chung, không lộ message gốc', async () => {
    vi.mocked(adminService.decideAppeal).mockRejectedValue(new Error('boom: stack trace'));
    const { result } = setup();
    act(() => result.current.openAcceptDialog(APPEAL));

    await act(async () => {
      result.current.dialogs.onConfirm(undefined);
    });

    expect(result.current.actionError).not.toBeNull();
    expect(result.current.actionError).not.toContain('boom');
  });

  it('mở hộp thoại mới xoá lỗi của lần trước', async () => {
    vi.mocked(adminService.decideAppeal).mockRejectedValue(new Error('x'));
    const { result } = setup();
    act(() => result.current.openAcceptDialog(APPEAL));
    await act(async () => {
      result.current.dialogs.onConfirm(undefined);
    });
    expect(result.current.actionError).not.toBeNull();

    act(() => result.current.openRejectDialog(APPEAL));

    expect(result.current.actionError).toBeNull();
  });

  it('đang gửi yêu cầu thì KHÔNG đóng được hộp thoại (Esc / bấm nền); xong thì tự đóng', async () => {
    let resolveRequest!: (value: ReturnType<typeof makeAppeal>) => void;
    vi.mocked(adminService.decideAppeal).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { result } = setup();
    act(() => result.current.openAcceptDialog(APPEAL));

    act(() => {
      result.current.dialogs.onConfirm(undefined);
    });
    await vi.waitFor(() => expect(result.current.isActionPending).toBe(true));
    act(() => result.current.dialogs.onOpenChange(false));

    expect(result.current.dialogs.isOpen).toBe(true);

    await act(async () => {
      resolveRequest(makeAppeal());
    });
    await vi.waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
  });

  it('chưa mở hộp thoại mà gọi onConfirm thì không làm gì (không gọi service)', async () => {
    const { result } = setup();

    await act(async () => {
      result.current.dialogs.onConfirm('x');
    });

    expect(adminService.decideAppeal).not.toHaveBeenCalled();
  });
});
