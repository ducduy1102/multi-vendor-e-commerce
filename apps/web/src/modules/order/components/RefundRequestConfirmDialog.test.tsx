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

  it.each([
    ['withdraw', 'Rút yêu cầu'],
    ['escalate', 'Gửi khiếu nại'],
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
