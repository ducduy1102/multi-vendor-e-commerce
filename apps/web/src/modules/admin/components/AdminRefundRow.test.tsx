import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminRefund } from '../types';
import { ADMIN_REFUND_GRID_CLASS } from './admin-refund-row.constants';
import { AdminRefundRow } from './AdminRefundRow';

const ORDER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function item(overrides: Partial<AdminRefund> = {}): AdminRefund {
  return {
    id: 'refund-1',
    status: 'FAILED',
    amount: '320000',
    attempts: 3,
    reason: null,
    failureReason: null,
    gatewayRef: null,
    initiatedByType: 'SYSTEM',
    createdAt: '2026-10-01T03:00:00.000Z',
    updatedAt: '2026-10-02T03:00:00.000Z',
    completedAt: null,
    canRetry: true,
    canMarkCompleted: true,
    payment: {
      id: 'payment-1',
      method: 'VNPAY',
      status: 'SUCCESS',
      amount: '320000',
      refundedAmount: '0',
      txnRef: 'TXN-ABCDEF123456',
      transactionId: '14883201',
    },
    order: {
      id: ORDER_ID,
      status: 'CANCELLED',
      totalAmount: '320000',
      recipientName: 'Trần Thị B',
    },
    buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    ...overrides,
  };
}

function setup(overrides: Partial<AdminRefund> = {}, isDisabled = false) {
  const onRetry = vi.fn();
  const onMarkCompleted = vi.fn();
  const utils = render(
    withIntl(
      <ul>
        <AdminRefundRow
          refund={item(overrides)}
          isDisabled={isDisabled}
          onRetry={onRetry}
          onMarkCompleted={onMarkCompleted}
        />
      </ul>,
    ),
  );
  return { ...utils, onRetry, onMarkCompleted };
}

describe('AdminRefundRow — nội dung', () => {
  it('cột khoản hoàn: số tiền, cách thanh toán + lúc tạo, người mua, số lần đã gọi cổng', () => {
    setup();

    expect(screen.getByText(/320\.000/)).toBeInTheDocument();
    expect(screen.getByText(/^VNPay · Tạo lúc .*2026/)).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A · a@example.com')).toBeInTheDocument();
    expect(screen.getByText('Đã gọi cổng 3 lần')).toBeInTheDocument();
  });

  it('lý do hoàn (nếu có) hiện cắt 2 dòng; không có thì không có dòng đó', () => {
    const { unmount } = setup({ reason: 'Khách trả hai lần' });
    expect(screen.getByText('Lý do hoàn: Khách trả hai lần')).toHaveClass('line-clamp-2');
    unmount();

    setup({ reason: null });
    expect(screen.queryByText(/Lý do hoàn:/)).not.toBeInTheDocument();
  });

  it('cột thanh toán: đơn gắn với khoản hoàn + các MÃ để tìm giao dịch bên cổng khi hoàn tay', () => {
    setup({ gatewayRef: 'MANUAL:REF-1' });

    expect(screen.getByText('Đơn #0f8fad5b · Trần Thị B')).toBeInTheDocument();
    expect(screen.getByText('Mã giao dịch của sàn: TXN-ABCDEF123456')).toBeInTheDocument();
    expect(screen.getByText('Mã giao dịch của cổng: 14883201')).toBeInTheDocument();
    expect(screen.getByText('Mã hoàn: MANUAL:REF-1')).toBeInTheDocument();
  });

  it('thanh toán bất thường không gắn đơn -> nói rõ, không có "Đơn #…"', () => {
    setup({ order: null });

    expect(screen.getByText('Thanh toán bất thường — không gắn đơn nào')).toBeInTheDocument();
    expect(screen.queryByText(/^Đơn #/)).not.toBeInTheDocument();
  });

  it('mã của cổng/mã hoàn chưa có (null) -> không có dòng trống', () => {
    setup({ payment: { ...item().payment, transactionId: null }, gatewayRef: null });

    expect(screen.queryByText(/Mã giao dịch của cổng/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mã hoàn:/)).not.toBeInTheDocument();
  });

  it('các mã dài không dấu cách ngắt được (break-all), không đẩy bảng rộng ra', () => {
    setup({
      payment: { ...item().payment, txnRef: 'T'.repeat(200), transactionId: 'G'.repeat(200) },
      gatewayRef: 'R'.repeat(200),
    });

    for (const text of [
      `Mã giao dịch của sàn: ${'T'.repeat(200)}`,
      `Mã giao dịch của cổng: ${'G'.repeat(200)}`,
      `Mã hoàn: ${'R'.repeat(200)}`,
    ]) {
      expect(screen.getByText(text)).toHaveClass('break-all');
    }
  });
});

describe('AdminRefundRow — trạng thái', () => {
  it.each([
    ['FAILED', 'Hoàn tiền lỗi'],
    ['PENDING', 'Đang chờ cổng'],
    ['SUCCEEDED', 'Đã hoàn'],
  ] as const)('khoản %s: huy hiệu "%s"', (status, label) => {
    setup({ status, canRetry: false, canMarkCompleted: false });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('LÝ DO LỖI nội bộ của cổng hiện cho Admin (cắt 3 dòng, ngắt chữ); không có thì không hiện', () => {
    const { unmount } = setup({ failureReason: 'Gateway rejected: duplicate request id' });
    expect(screen.getByText('Lý do lỗi: Gateway rejected: duplicate request id')).toHaveClass(
      'line-clamp-3',
      'break-words',
    );
    unmount();

    setup({ failureReason: null });
    expect(screen.queryByText(/Lý do lỗi:/)).not.toBeInTheDocument();
  });

  it('đã hoàn tất -> "Hoàn lúc <ngày giờ>"; chưa -> "Cập nhật <ngày giờ>"', () => {
    const { unmount } = setup({ status: 'SUCCEEDED', completedAt: '2026-10-03T03:00:00.000Z' });
    expect(screen.getByText(/Hoàn lúc .*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Cập nhật/)).not.toBeInTheDocument();
    unmount();

    setup({ completedAt: null });
    expect(screen.getByText(/Cập nhật .*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Hoàn lúc/)).not.toBeInTheDocument();
  });
});

describe('AdminRefundRow — thao tác chỉ theo cờ của BE', () => {
  it('canRetry + canMarkCompleted -> hai nút, bấm gọi đúng callback', async () => {
    const user = userEvent.setup();
    const { onRetry, onMarkCompleted } = setup();

    await user.click(screen.getByRole('button', { name: /^Thử lại/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onMarkCompleted).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^Ghi nhận hoàn tay/ }));
    expect(onMarkCompleted).toHaveBeenCalledTimes(1);
  });

  it('nút có tên truy cập kèm mã đơn (hoặc mã giao dịch nếu không gắn đơn)', () => {
    const { unmount } = setup();
    expect(screen.getByRole('button', { name: 'Thử lại: #0f8fad5b' })).toBeInTheDocument();
    unmount();

    setup({ order: null });
    expect(screen.getByRole('button', { name: 'Thử lại: #TXN-ABCD' })).toBeInTheDocument();
  });

  it('"Thử lại" là nút chính (primary), "Ghi nhận hoàn tay" là outline — không đỏ', () => {
    setup();

    expect(screen.getByRole('button', { name: /^Thử lại/ })).toHaveClass('bg-primary');
    const mark = screen.getByRole('button', { name: /^Ghi nhận hoàn tay/ });
    expect(mark).toHaveClass('border-border');
    expect(mark).not.toHaveClass('bg-destructive/10');
  });

  it('không cờ nào (đã hoàn / PENDING còn mới) -> không nút nào', () => {
    setup({ status: 'PENDING', canRetry: false, canMarkCompleted: false });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('hai cờ độc lập: chỉ canRetry -> chỉ "Thử lại"; chỉ canMarkCompleted -> chỉ "Ghi nhận hoàn tay"', () => {
    const { unmount } = setup({ canRetry: true, canMarkCompleted: false });
    expect(screen.getByRole('button', { name: /^Thử lại/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ghi nhận hoàn tay/ })).not.toBeInTheDocument();
    unmount();

    setup({ canRetry: false, canMarkCompleted: true });
    expect(screen.getByRole('button', { name: /^Ghi nhận hoàn tay/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Thử lại/ })).not.toBeInTheDocument();
  });

  it('đang có hành động chạy -> khoá cả hai nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onRetry, onMarkCompleted } = setup({}, true);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      await user.click(button);
    }

    expect(onRetry).not.toHaveBeenCalled();
    expect(onMarkCompleted).not.toHaveBeenCalled();
  });
});

describe('AdminRefundRow — bố cục', () => {
  it('dùng đúng hằng số lưới dùng chung với tiêu đề và có cột ngầm định co được ở mobile', () => {
    setup();

    const row = screen.getByRole('listitem');
    for (const cls of ADMIN_REFUND_GRID_CLASS.split(' ')) expect(row).toHaveClass(cls);
    expect(row).toHaveClass('grid-cols-1');
  });
});
