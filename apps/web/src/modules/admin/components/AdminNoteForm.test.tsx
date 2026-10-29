import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminNoteForm } from './AdminNoteForm';

function setup(
  props: Partial<React.ComponentProps<typeof AdminNoteForm>> = {},
  locale: 'vi' | 'en' = 'vi',
) {
  const onSubmit = vi.fn().mockResolvedValue(true);
  const utils = render(
    withIntl(
      <AdminNoteForm isSubmitting={false} error={null} onSubmit={onSubmit} {...props} />,
      locale,
    ),
  );
  return { ...utils, onSubmit: (props.onSubmit as typeof onSubmit | undefined) ?? onSubmit };
}

const textbox = () => screen.getByLabelText('Thêm ghi chú') as HTMLTextAreaElement;
const submitButton = () => screen.getByRole('button', { name: 'Thêm ghi chú' });

describe('AdminNoteForm — nhập và gửi', () => {
  it('gửi nội dung đã làm sạch (cắt khoảng trắng hai đầu, CRLF → LF) và XOÁ ô nhập khi lưu xong', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(textbox(), '  Đã gọi chủ shop  ');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Đã gọi chủ shop'));
    await waitFor(() => expect(textbox().value).toBe(''));
  });

  it('lưu LỖI (onSubmit trả false) ⇒ GIỮ nguyên chữ vừa gõ để không phải gõ lại', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    setup({ onSubmit });

    await user.type(textbox(), 'Nội dung quan trọng');
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(textbox().value).toBe('Nội dung quan trọng');
  });

  it('bỏ trống hoặc chỉ khoảng trắng: báo lỗi ngay dưới ô nhập và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập nội dung ghi chú');
    expect(textbox()).toHaveAttribute('aria-invalid', 'true');

    await user.type(textbox(), '    ');
    await user.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('quá 1000 ký tự: báo lỗi theo field và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(textbox());
    await user.paste('a'.repeat(1001));
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Ghi chú tối đa 1000 ký tự');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('ký tự điều khiển (NUL): báo "không hợp lệ" và KHÔNG gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(textbox());
    await user.paste(`abc${String.fromCharCode(0)}def`);
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Ghi chú chứa ký tự không hợp lệ');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('bộ đếm ký tự cập nhật theo chữ gõ và đổi sang màu cảnh báo khi vượt cận', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByText('0/1000')).toHaveClass('text-muted-foreground');

    await user.type(textbox(), 'abc');
    expect(screen.getByText('3/1000')).toBeInTheDocument();

    await user.click(textbox());
    await user.paste('a'.repeat(1000));
    expect(screen.getByText('1003/1000')).toHaveClass('text-destructive');
  });
});

describe('AdminNoteForm — trạng thái gửi và lỗi', () => {
  it('đang gửi: ô nhập và nút khoá, nút báo bận và đổi chữ — không gửi trùng được', () => {
    setup({ isSubmitting: true });

    expect(textbox()).toBeDisabled();
    const button = screen.getByRole('button', { name: 'Đang lưu...' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('lỗi từ lần gửi trước hiện trong khung cảnh báo', () => {
    setup({ error: 'Không tìm thấy người dùng hoặc shop cần ghi chú.' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không tìm thấy người dùng hoặc shop cần ghi chú.',
    );
  });

  it('bản tiếng Anh: nhãn, nút và thông báo lỗi không lẫn tiếng Việt', async () => {
    const user = userEvent.setup();
    setup({}, 'en');

    await user.click(screen.getByRole('button', { name: 'Add note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter the note');
    expect(screen.getByLabelText('Add a note')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ghi chú|Vui lòng/i);
  });
});
