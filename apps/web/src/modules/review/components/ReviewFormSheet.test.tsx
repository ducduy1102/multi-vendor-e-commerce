import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { ReviewFormSheet, type ReviewFormSheetProps } from './ReviewFormSheet';

function renderSheet(props: Partial<ReviewFormSheetProps> = {}) {
  const onOpenChange = vi.fn();
  const onSubmit = vi.fn();
  render(
    withIntl(
      <ReviewFormSheet
        open
        onOpenChange={onOpenChange}
        mode="create"
        productName="Áo thun nam"
        isSubmitting={false}
        onSubmit={onSubmit}
        {...props}
      />,
    ),
  );
  return { onOpenChange, onSubmit };
}

describe('ReviewFormSheet', () => {
  it('đóng: không render gì (form chỉ mount khi mở nên mỗi lần mở là một form mới)', () => {
    renderSheet({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('viết mới: tiêu đề "Viết đánh giá", mô tả, tên sản phẩm và form', () => {
    renderSheet();

    const dialog = screen.getByRole('dialog', { name: 'Viết đánh giá' });
    expect(
      within(dialog).getByText('Chia sẻ trải nghiệm của bạn về sản phẩm này.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Áo thun nam')).toBeInTheDocument();
    expect(within(dialog).getByRole('radiogroup', { name: 'Số sao của bạn' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Gửi đánh giá' })).toBeInTheDocument();
  });

  it('sửa: tiêu đề "Sửa đánh giá", nhắc chỉ sửa được một lần, điền sẵn giá trị cũ', () => {
    renderSheet({ mode: 'edit', initialValues: { rating: 2, comment: 'Chưa ưng' } });

    const dialog = screen.getByRole('dialog', { name: 'Sửa đánh giá' });
    expect(within(dialog).getByText(/chỉ sửa được đánh giá này một lần/)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: '2 sao' })).toBeChecked();
    expect(within(dialog).getByDisplayValue('Chưa ưng')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
  });

  it('nút Huỷ trong form -> onOpenChange(false); tên sản phẩm dài vẫn ngắt được (break-words)', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderSheet({ productName: 'X'.repeat(300) });

    expect(screen.getByText('X'.repeat(300))).toHaveClass('break-words', 'line-clamp-2');
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('đang gửi: form bị khoá; lỗi API hiện trong ngăn kéo', () => {
    renderSheet({ isSubmitting: true, errorMessage: 'Bạn chưa thể đánh giá sản phẩm này' });

    expect(screen.getByRole('button', { name: 'Đang gửi...' })).toBeDisabled();
    expect(screen.getByText('Bạn chưa thể đánh giá sản phẩm này')).toBeInTheDocument();
  });

  it('gửi form -> onSubmit nhận giá trị đã validate', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSheet();

    await user.click(screen.getByRole('radio', { name: '5 sao' }));
    await user.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));

    expect(onSubmit).toHaveBeenCalledWith({ rating: 5, comment: undefined });
  });
});
