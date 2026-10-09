import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminRefundablePayment } from '../types';
import { ADMIN_REFUND_GRID_CLASS } from './admin-refund-row.constants';
import { AdminRefundablePaymentRow } from './AdminRefundablePaymentRow';

function item(overrides: Partial<AdminRefundablePayment> = {}): AdminRefundablePayment {
  return {
    id: 'payment-1',
    kind: 'PAID_AFTER_EXPIRY',
    method: 'VNPAY',
    amount: '320000',
    paidAt: '2026-10-03T03:00:00.000Z',
    txnRef: 'TXN-ABCDEF123456',
    transactionId: '14883201',
    checkoutGroupId: 'group-1',
    buyer: { name: 'Nguyễn Văn A', email: 'a@example.com' },
    orders: [
      { id: '0f8fad5b-d9cb-469f-a165-70867728950e', status: 'CANCELLED', totalAmount: '200000' },
      { id: '1a2b3c4d-d9cb-469f-a165-70867728950e', status: 'CANCELLED', totalAmount: '120000' },
    ],
    ...overrides,
  };
}

function setup(overrides: Partial<AdminRefundablePayment> = {}, isDisabled = false) {
  const onRefund = vi.fn();
  const utils = render(
    withIntl(
      <ul>
        <AdminRefundablePaymentRow
          payment={item(overrides)}
          isDisabled={isDisabled}
          onRefund={onRefund}
        />
      </ul>,
    ),
  );
  return { ...utils, onRefund };
}

describe('AdminRefundablePaymentRow', () => {
  it('cột thanh toán: số tiền, cách thanh toán + lúc trả, người mua, các mã tìm giao dịch bên cổng', () => {
    setup();

    expect(screen.getByText(/320\.000/)).toBeInTheDocument();
    expect(screen.getByText(/^VNPay · trả lúc .*2026/)).toBeInTheDocument();
    expect(screen.getByText('Nguyễn Văn A · a@example.com')).toBeInTheDocument();
    expect(screen.getByText('Mã giao dịch của sàn: TXN-ABCDEF123456')).toBeInTheDocument();
    expect(screen.getByText('Mã giao dịch của cổng: 14883201')).toBeInTheDocument();
  });

  it('chưa biết lúc trả / mã cổng (null) -> không có phần thừa', () => {
    setup({ paidAt: null, transactionId: null });

    expect(screen.getByText('VNPay')).toBeInTheDocument();
    expect(screen.queryByText(/trả lúc/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mã giao dịch của cổng/)).not.toBeInTheDocument();
  });

  it('cột các đơn: MỖI đơn của lần đặt hàng một dòng "mã rút gọn · trạng thái · tiền" để thấy vì sao bất thường', () => {
    setup();

    // list[0] là <ul> bọc của test, list[1] là danh sách đơn trong cột giữa của dòng.
    const lines = within(screen.getAllByRole('list')[1]).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent(/^Đơn #0f8fad5b · Đã hủy · .*200\.000/);
    expect(lines[1]).toHaveTextContent(/^Đơn #1a2b3c4d · Đã hủy · .*120\.000/);
  });

  it('đến sau khi đơn hết hạn: huy hiệu + câu giải thích mọi đơn đã hủy', () => {
    setup({ kind: 'PAID_AFTER_EXPIRY' });

    expect(screen.getByText('Đến sau khi đơn hết hạn')).toBeInTheDocument();
    expect(screen.getByText(/mọi đơn của lần đặt này đã bị hủy/)).toBeInTheDocument();
  });

  it('thanh toán trùng: huy hiệu + câu giải thích khách trả hai lần', () => {
    setup({ kind: 'DUPLICATE' });

    expect(screen.getByText('Thanh toán trùng')).toBeInTheDocument();
    expect(screen.getByText(/trả hai lần cho cùng một lần đặt hàng/)).toBeInTheDocument();
  });

  it('một hành động duy nhất "Hoàn tiền" (nút chính), tên truy cập kèm mã giao dịch, bấm gọi callback', async () => {
    const user = userEvent.setup();
    const { onRefund } = setup();

    const button = screen.getByRole('button', { name: 'Hoàn tiền: #TXN-ABCD' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(button).toHaveClass('bg-primary');
    await user.click(button);

    expect(onRefund).toHaveBeenCalledTimes(1);
  });

  it('đang có hành động chạy -> khoá nút, bấm không gọi callback', async () => {
    const user = userEvent.setup();
    const { onRefund } = setup({}, true);

    const button = screen.getByRole('button', { name: /^Hoàn tiền/ });
    expect(button).toBeDisabled();
    await user.click(button);

    expect(onRefund).not.toHaveBeenCalled();
  });

  it('mã giao dịch dài không dấu cách ngắt được (break-all)', () => {
    setup({ txnRef: 'T'.repeat(200), transactionId: 'G'.repeat(200) });

    expect(screen.getByText(`Mã giao dịch của sàn: ${'T'.repeat(200)}`)).toHaveClass('break-all');
    expect(screen.getByText(`Mã giao dịch của cổng: ${'G'.repeat(200)}`)).toHaveClass('break-all');
  });

  it('dùng đúng hằng số lưới dùng chung với tiêu đề; mỗi trường có nhãn (md:sr-only)', () => {
    setup();

    const row = screen.getAllByRole('listitem')[0];
    for (const cls of ADMIN_REFUND_GRID_CLASS.split(' ')) expect(row).toHaveClass(cls);
    for (const name of ['Thanh toán', 'Các đơn của lần đặt', 'Vì sao bất thường']) {
      expect(within(row).getByText(name, { selector: 'span' })).toHaveClass('md:sr-only');
    }
  });
});
