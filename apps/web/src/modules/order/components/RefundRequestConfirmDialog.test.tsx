import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import {
  RefundRequestConfirmDialog,
  type RefundRequestConfirmVariant,
} from './RefundRequestConfirmDialog';

function setup({
  variant = 'withdraw',
  open = true,
  isPending = false,
}: { variant?: RefundRequestConfirmVariant; open?: boolean; isPending?: boolean } = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    withIntl(
      <RefundRequestConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        variant={variant}
        isPending={isPending}
        onConfirm={onConfirm}
      />,
    ),
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe('RefundRequestConfirmDialog', () => {
  it('đóng -> không render nội dung', () => {
    setup({ open: false });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('rút yêu cầu: tiêu đề, mô tả (có thể gửi lại yêu cầu mới), nút "Rút yêu cầu" và "Giữ yêu cầu"', () => {
    setup({ variant: 'withdraw' });

    expect(screen.getByText('Rút yêu cầu này?')).toBeInTheDocument();
    expect(screen.getByText(/gửi một yêu cầu mới sau đó/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rút yêu cầu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Giữ yêu cầu' })).toBeInTheDocument();
  });

  it('khiếu nại: tiêu đề, mô tả (quyết định cuối cùng, chỉ một lần), nút "Gửi khiếu nại" và "Quay lại"', () => {
    setup({ variant: 'escalate' });

    expect(screen.getByText('Khiếu nại lên sàn?')).toBeInTheDocument();
    expect(screen.getByText(/quyết định cuối cùng/)).toBeInTheDocument();
    expect(screen.getByText(/chỉ khiếu nại được một lần/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi khiếu nại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
  });

  it('chấp thuận yêu cầu HỦY: nói rõ đơn bị hủy, hàng về kho, tiền (nếu có) được hoàn; nút "Chấp thuận" và "Quay lại"', () => {
    setup({ variant: 'approveCancel' });

    expect(screen.getByText('Chấp thuận yêu cầu hủy đơn?')).toBeInTheDocument();
    expect(screen.getByText(/trả lại kho/)).toBeInTheDocument();
    expect(screen.getByText(/hoàn về phương thức ban đầu/)).toBeInTheDocument();
    expect(screen.getByText(/Không thể khôi phục/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chấp thuận' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
  });

  it('chấp thuận yêu cầu TRẢ HÀNG: NHẮC hàng trả về KHÔNG tự cộng vào kho (shop tự cập nhật tồn kho)', () => {
    setup({ variant: 'approveReturn' });

    expect(screen.getByText('Chấp thuận yêu cầu trả hàng/hoàn tiền?')).toBeInTheDocument();
    expect(screen.getByText(/KHÔNG tự động được cộng lại vào kho/)).toBeInTheDocument();
    expect(screen.getByText(/tự cập nhật tồn kho/)).toBeInTheDocument();
    expect(screen.getByText(/đơn COD/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chấp thuận' })).toBeInTheDocument();
  });

  it('hai biến thể chấp thuận khác nhau ở hệ quả kho: hủy KHÔNG có câu nhắc kho thủ công, trả hàng KHÔNG hứa "trả lại kho"', () => {
    const { unmount } = setup({ variant: 'approveCancel' });
    expect(screen.queryByText(/KHÔNG tự động/)).not.toBeInTheDocument();
    unmount();

    setup({ variant: 'approveReturn' });
    expect(screen.queryByText(/được trả lại kho/)).not.toBeInTheDocument();
  });

  it.each([
    ['withdraw', 'Rút yêu cầu'],
    ['escalate', 'Gửi khiếu nại'],
    ['approveCancel', 'Chấp thuận'],
    ['approveReturn', 'Chấp thuận'],
  ] as const)('%s: bấm nút xác nhận gọi onConfirm đúng một lần', async (variant, name) => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ variant });

    await user.click(screen.getByRole('button', { name }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('đang xử lý: khoá cả nút xác nhận lẫn nút huỷ (hộp thoại giữ mở tới khi xong)', () => {
    setup({ variant: 'withdraw', isPending: true });

    expect(screen.getByRole('button', { name: 'Rút yêu cầu' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Giữ yêu cầu' })).toBeDisabled();
  });

  it('nút xác nhận là nút trung tính (không đỏ): không phải hành động phá huỷ dữ liệu', () => {
    setup({ variant: 'escalate' });

    const confirm = screen.getByRole('button', { name: 'Gửi khiếu nại' });
    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).not.toHaveClass('bg-destructive/10');
  });
});
