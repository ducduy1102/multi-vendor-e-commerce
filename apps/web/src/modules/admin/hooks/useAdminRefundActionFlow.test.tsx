import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import vietnamese from '../../../../messages/vi.json';
import * as adminService from '../services/admin.service';
import type { AdminRefund } from '../types';
import { useAdminRefundActionFlow } from './useAdminRefundActionFlow';

vi.mock('../services/admin.service', () => ({
  decideRefundRequest: vi.fn(),
  retryRefund: vi.fn(),
  markRefundCompleted: vi.fn(),
  refundPayment: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const REQUEST = { id: 'request-1', kind: 'RETURN' } as const;
const REFUND = { id: 'refund-1' };
const PAYMENT = { id: 'payment-1' };

const refundWith = (status: AdminRefund['status']) => ({ id: 'refund-1', status }) as AdminRefund;
const apiError = (status: number, code?: string) => new ApiError('x', status, code);
const admin = vietnamese.admin as Record<string, string>;

// Mutation của react-query chỉ gọi service sau vài microtask, nên khẳng định "KHÔNG gọi API" ngay sau `act` đồng bộ
// luôn đúng kể cả khi code có lỗi (đã gặp: đột biến bỏ kiểm loại hộp thoại vẫn qua test). Mọi test phủ định phải chờ
// hết việc treo rồi mới khẳng định.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    withIntl(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
  return renderHook(() => useAdminRefundActionFlow(), { wrapper });
}

describe('useAdminRefundActionFlow', () => {
  beforeEach(() => {
    vi.mocked(adminService.decideRefundRequest).mockReset();
    vi.mocked(adminService.retryRefund).mockReset();
    vi.mocked(adminService.markRefundCompleted).mockReset();
    vi.mocked(adminService.refundPayment).mockReset();
    toast.success.mockReset();
    toast.info.mockReset();
    toast.error.mockReset();
  });

  it('ban đầu: không hộp thoại nào mở, không lỗi, không hành động nào đang chạy', () => {
    const { result } = setup();

    expect(result.current.dialogs.dialog).toBeNull();
    expect(result.current.dialogs.isOpen).toBe(false);
    expect(result.current.actionError).toBeNull();
    expect(result.current.isActionPending).toBe(false);
  });

  describe('duyệt / từ chối yêu cầu', () => {
    it('mở hộp thoại giữ đúng yêu cầu (id + loại) để hộp thoại chọn câu theo loại', () => {
      const { result } = setup();

      act(() => result.current.openApproveRequestDialog(REQUEST));
      expect(result.current.dialogs.dialog).toEqual({ kind: 'approveRequest', request: REQUEST });

      act(() => result.current.openRejectRequestDialog(REQUEST));
      expect(result.current.dialogs.dialog).toEqual({ kind: 'rejectRequest', request: REQUEST });
      expect(result.current.dialogs.isOpen).toBe(true);
    });

    it('duyệt kèm ghi chú -> gọi service (requestId, { decision: APPROVE, note }), toast thành công, đóng hộp thoại', async () => {
      vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openApproveRequestDialog(REQUEST));

      act(() => result.current.dialogs.onApproveRequest('Đã kiểm tra'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.decideRefundRequest).toHaveBeenCalledWith('request-1', {
        decision: 'APPROVE',
        note: 'Đã kiểm tra',
      });
      expect(toast.success).toHaveBeenCalledWith('Đã chấp thuận yêu cầu');
      expect(result.current.actionError).toBeNull();
    });

    it('duyệt không ghi chú -> note là undefined (ghi chú của duyệt là tuỳ chọn)', async () => {
      vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openApproveRequestDialog(REQUEST));

      act(() => result.current.dialogs.onApproveRequest(undefined));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.decideRefundRequest).toHaveBeenCalledWith('request-1', {
        decision: 'APPROVE',
        note: undefined,
      });
    });

    it('từ chối kèm lý do -> gọi service (requestId, { decision: REJECT, note }), toast "Đã từ chối yêu cầu"', async () => {
      vi.mocked(adminService.decideRefundRequest).mockResolvedValue({} as never);
      const { result } = setup();
      act(() => result.current.openRejectRequestDialog(REQUEST));

      act(() => result.current.dialogs.onRejectRequest('Thiếu bằng chứng'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.decideRefundRequest).toHaveBeenCalledWith('request-1', {
        decision: 'REJECT',
        note: 'Thiếu bằng chứng',
      });
      expect(toast.success).toHaveBeenCalledWith('Đã từ chối yêu cầu');
    });

    it('409 (shop/người mua vừa xử lý) -> đóng hộp thoại, lỗi đã dịch theo mã, KHÔNG toast thành công', async () => {
      vi.mocked(adminService.decideRefundRequest).mockRejectedValue(
        apiError(409, 'REFUND_REQUEST_INVALID_TRANSITION'),
      );
      const { result } = setup();
      act(() => result.current.openApproveRequestDialog(REQUEST));

      act(() => result.current.dialogs.onApproveRequest(undefined));

      await waitFor(() =>
        expect(result.current.actionError).toBe(
          'Yêu cầu vừa được cập nhật, vui lòng tải lại trang',
        ),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('lỗi không rõ -> câu chung, không lộ message gốc', async () => {
      vi.mocked(adminService.decideRefundRequest).mockRejectedValue(new Error('boom: stack'));
      const { result } = setup();
      act(() => result.current.openRejectRequestDialog(REQUEST));

      act(() => result.current.dialogs.onRejectRequest('x'));

      await waitFor(() => expect(result.current.actionError).toBe(admin.actionError));
      expect(result.current.actionError).not.toContain('boom');
    });

    it('hộp thoại khác loại đang mở (hoặc chưa mở) -> onApproveRequest/onRejectRequest không gọi API', async () => {
      const { result } = setup();

      act(() => result.current.dialogs.onApproveRequest(undefined));
      act(() => result.current.dialogs.onRejectRequest('x'));
      act(() => result.current.openMarkCompletedDialog(REFUND));
      act(() => result.current.dialogs.onApproveRequest(undefined));
      act(() => result.current.dialogs.onRejectRequest('x'));
      await settle();

      expect(adminService.decideRefundRequest).not.toHaveBeenCalled();
    });
  });

  it('duyệt và từ chối có CÙNG hình dạng dữ liệu nhưng so theo loại: mở hộp thoại từ chối thì onApproveRequest không gọi API (và ngược lại)', async () => {
    const { result } = setup();

    act(() => result.current.openRejectRequestDialog(REQUEST));
    act(() => result.current.dialogs.onApproveRequest(undefined));
    await settle();
    expect(adminService.decideRefundRequest).not.toHaveBeenCalled();

    act(() => result.current.openApproveRequestDialog(REQUEST));
    act(() => result.current.dialogs.onRejectRequest('x'));
    await settle();
    expect(adminService.decideRefundRequest).not.toHaveBeenCalled();
  });

  describe('thử lại một khoản hoàn lỗi (qua hộp thoại xác nhận)', () => {
    it('mở hộp thoại giữ đúng khoản; CHƯA gọi API cho tới khi xác nhận', () => {
      const { result } = setup();

      act(() => result.current.openRetryDialog(REFUND));

      expect(result.current.dialogs.dialog).toEqual({ kind: 'retryRefund', refund: REFUND });
      expect(result.current.dialogs.isOpen).toBe(true);
      expect(adminService.retryRefund).not.toHaveBeenCalled();
    });

    it('xác nhận, cổng hoàn được -> gọi service đúng khoản, toast success, đóng hộp thoại, không lỗi', async () => {
      vi.mocked(adminService.retryRefund).mockResolvedValue(refundWith('SUCCEEDED'));
      const { result } = setup();
      act(() => result.current.openRetryDialog(REFUND));

      act(() => result.current.dialogs.onRetryRefund());

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.retryRefund).toHaveBeenCalledWith('refund-1');
      expect(toast.success).toHaveBeenCalledWith('Đã hoàn tiền thành công');
      expect(result.current.actionError).toBeNull();
    });

    it('200 nhưng cổng vẫn chưa trả lời (PENDING) -> toast info, KHÔNG báo thành công', async () => {
      vi.mocked(adminService.retryRefund).mockResolvedValue(refundWith('PENDING'));
      const { result } = setup();
      act(() => result.current.openRetryDialog(REFUND));

      act(() => result.current.dialogs.onRetryRefund());

      await waitFor(() =>
        expect(toast.info).toHaveBeenCalledWith('Khoản hoàn đang chờ cổng phản hồi'),
      );
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('200 nhưng cổng vẫn từ chối (FAILED) -> toast error, KHÔNG báo thành công', async () => {
      vi.mocked(adminService.retryRefund).mockResolvedValue(refundWith('FAILED'));
      const { result } = setup();
      act(() => result.current.openRetryDialog(REFUND));

      act(() => result.current.dialogs.onRetryRefund());

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Cổng từ chối khoản hoàn — bạn có thể thử lại hoặc ghi nhận hoàn tay',
        ),
      );
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('409 PAYMENT_REFUND_NOT_RETRYABLE (Admin khác vừa xử lý) -> đóng hộp thoại, lỗi đã dịch, không toast', async () => {
      vi.mocked(adminService.retryRefund).mockRejectedValue(
        apiError(409, 'PAYMENT_REFUND_NOT_RETRYABLE'),
      );
      const { result } = setup();
      act(() => result.current.openRetryDialog(REFUND));

      act(() => result.current.dialogs.onRetryRefund());

      await waitFor(() =>
        expect(result.current.actionError).toBe(admin.errorPaymentRefundNotRetryable),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('hành động tiếp theo xoá lỗi của hành động trước', async () => {
      vi.mocked(adminService.retryRefund)
        .mockRejectedValueOnce(apiError(409, 'PAYMENT_REFUND_NOT_RETRYABLE'))
        .mockResolvedValueOnce(refundWith('SUCCEEDED'));
      const { result } = setup();
      act(() => result.current.openRetryDialog(REFUND));
      act(() => result.current.dialogs.onRetryRefund());
      await waitFor(() => expect(result.current.actionError).not.toBeNull());

      act(() => result.current.openRetryDialog(REFUND));
      expect(result.current.actionError).toBeNull();
      act(() => result.current.dialogs.onRetryRefund());

      await waitFor(() => expect(toast.success).toHaveBeenCalled());
      expect(result.current.actionError).toBeNull();
    });

    it('chưa mở hộp thoại, hoặc đang mở hộp thoại KHÁC cùng hình dạng (ghi nhận hoàn tay) -> onRetryRefund không gọi API', async () => {
      const { result } = setup();

      act(() => result.current.dialogs.onRetryRefund());
      act(() => result.current.openMarkCompletedDialog(REFUND));
      act(() => result.current.dialogs.onRetryRefund());
      await settle();

      expect(adminService.retryRefund).not.toHaveBeenCalled();
    });
  });

  describe('ghi nhận hoàn tay', () => {
    it('mở hộp thoại cho đúng khoản', () => {
      const { result } = setup();

      act(() => result.current.openMarkCompletedDialog(REFUND));

      expect(result.current.dialogs.dialog).toEqual({ kind: 'markCompleted', refund: REFUND });
    });

    it('xác nhận kèm mã tham chiếu -> gọi service (refundId, { reference }), toast theo trạng thái khoản, đóng hộp thoại', async () => {
      vi.mocked(adminService.markRefundCompleted).mockResolvedValue(refundWith('SUCCEEDED'));
      const { result } = setup();
      act(() => result.current.openMarkCompletedDialog(REFUND));

      act(() => result.current.dialogs.onMarkCompleted('REF-123'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.markRefundCompleted).toHaveBeenCalledWith('refund-1', {
        reference: 'REF-123',
      });
      expect(toast.success).toHaveBeenCalledWith('Đã hoàn tiền thành công');
    });

    it('lỗi -> đóng hộp thoại, hiện lỗi đã dịch, không toast', async () => {
      vi.mocked(adminService.markRefundCompleted).mockRejectedValue(
        apiError(409, 'PAYMENT_REFUND_NOT_RETRYABLE'),
      );
      const { result } = setup();
      act(() => result.current.openMarkCompletedDialog(REFUND));

      act(() => result.current.dialogs.onMarkCompleted('REF-1'));

      await waitFor(() =>
        expect(result.current.actionError).toBe(admin.errorPaymentRefundNotRetryable),
      );
      expect(result.current.dialogs.isOpen).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('hộp thoại khác loại đang mở (kể cả thử lại, cùng hình dạng) -> onMarkCompleted không gọi API', async () => {
      const { result } = setup();

      act(() => result.current.openRefundPaymentDialog(PAYMENT));
      act(() => result.current.dialogs.onMarkCompleted('REF'));
      await settle();
      expect(adminService.markRefundCompleted).not.toHaveBeenCalled();

      act(() => result.current.openRetryDialog(REFUND));
      act(() => result.current.dialogs.onMarkCompleted('REF'));
      await settle();
      expect(adminService.markRefundCompleted).not.toHaveBeenCalled();
    });
  });

  describe('hoàn một thanh toán bất thường', () => {
    it('mở hộp thoại cho đúng thanh toán', () => {
      const { result } = setup();

      act(() => result.current.openRefundPaymentDialog(PAYMENT));

      expect(result.current.dialogs.dialog).toEqual({ kind: 'refundPayment', payment: PAYMENT });
    });

    it('xác nhận kèm lý do -> gọi service (paymentId, { reason }), toast theo kết quả khoản hoàn mới', async () => {
      vi.mocked(adminService.refundPayment).mockResolvedValue(refundWith('PENDING'));
      const { result } = setup();
      act(() => result.current.openRefundPaymentDialog(PAYMENT));

      act(() => result.current.dialogs.onRefundPayment('Khách trả hai lần'));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.refundPayment).toHaveBeenCalledWith('payment-1', {
        reason: 'Khách trả hai lần',
      });
      expect(toast.info).toHaveBeenCalledWith('Khoản hoàn đang chờ cổng phản hồi');
    });

    it('không có lý do -> reason là undefined (tuỳ chọn)', async () => {
      vi.mocked(adminService.refundPayment).mockResolvedValue(refundWith('SUCCEEDED'));
      const { result } = setup();
      act(() => result.current.openRefundPaymentDialog(PAYMENT));

      act(() => result.current.dialogs.onRefundPayment(undefined));

      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(adminService.refundPayment).toHaveBeenCalledWith('payment-1', { reason: undefined });
    });

    it('hộp thoại khác loại đang mở -> onRefundPayment không gọi API', async () => {
      const { result } = setup();

      act(() => result.current.dialogs.onRefundPayment('x'));
      act(() => result.current.openMarkCompletedDialog(REFUND));
      act(() => result.current.dialogs.onRefundPayment('x'));
      await settle();

      expect(adminService.refundPayment).not.toHaveBeenCalled();
    });

    it('409 PAYMENT_NOT_REFUNDABLE (Admin khác vừa hoàn) -> lỗi đã dịch, không toast', async () => {
      vi.mocked(adminService.refundPayment).mockRejectedValue(
        apiError(409, 'PAYMENT_NOT_REFUNDABLE'),
      );
      const { result } = setup();
      act(() => result.current.openRefundPaymentDialog(PAYMENT));

      act(() => result.current.dialogs.onRefundPayment(undefined));

      await waitFor(() => expect(result.current.actionError).toBe(admin.errorPaymentNotRefundable));
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  it('mở hộp thoại mới xoá lỗi của hành động trước', async () => {
    vi.mocked(adminService.retryRefund).mockRejectedValue(
      apiError(409, 'PAYMENT_REFUND_NOT_RETRYABLE'),
    );
    const { result } = setup();
    act(() => result.current.openRetryDialog(REFUND));
    act(() => result.current.dialogs.onRetryRefund());
    await waitFor(() => expect(result.current.actionError).not.toBeNull());

    act(() => result.current.openRefundPaymentDialog(PAYMENT));

    expect(result.current.actionError).toBeNull();
  });

  describe('khoá chéo và đóng hộp thoại', () => {
    it('đang rảnh -> đóng được (Esc/bấm nền/nút Quay lại)', () => {
      const { result } = setup();
      act(() => result.current.openMarkCompletedDialog(REFUND));

      act(() => result.current.dialogs.onOpenChange(false));

      expect(result.current.dialogs.isOpen).toBe(false);
    });

    it('đang gửi quyết định -> bỏ qua yêu cầu đóng, khoá mọi hành động, tự đóng khi xong', async () => {
      let resolveDecision: (value: never) => void = () => undefined;
      vi.mocked(adminService.decideRefundRequest).mockReturnValue(
        new Promise((resolve) => {
          resolveDecision = resolve as (value: never) => void;
        }),
      );
      const { result } = setup();
      act(() => result.current.openApproveRequestDialog(REQUEST));
      act(() => result.current.dialogs.onApproveRequest(undefined));
      await waitFor(() => expect(result.current.isActionPending).toBe(true));
      expect(result.current.dialogs.isDecisionPending).toBe(true);
      expect(result.current.dialogs.isMarkCompletedPending).toBe(false);

      act(() => result.current.dialogs.onOpenChange(false));
      expect(result.current.dialogs.isOpen).toBe(true);

      await act(async () => resolveDecision({} as never));
      await waitFor(() => expect(result.current.dialogs.isOpen).toBe(false));
      expect(result.current.isActionPending).toBe(false);
    });

    it('thử lại đang chạy khoá mọi hành động khác và không cho đóng hộp thoại, để không hoàn hai lần cùng lúc', async () => {
      let resolveRetry: (value: AdminRefund) => void = () => undefined;
      vi.mocked(adminService.retryRefund).mockReturnValue(
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
      );
      const { result } = setup();

      act(() => result.current.openRetryDialog(REFUND));
      act(() => result.current.dialogs.onRetryRefund());
      await waitFor(() => expect(result.current.isActionPending).toBe(true));
      expect(result.current.dialogs.isRetryPending).toBe(true);

      // Đang gửi thì không đóng được hộp thoại (Esc/bấm nền).
      act(() => result.current.dialogs.onOpenChange(false));
      expect(result.current.dialogs.isOpen).toBe(true);

      await act(async () => resolveRetry(refundWith('SUCCEEDED')));
      await waitFor(() => expect(result.current.isActionPending).toBe(false));
    });
  });
});
