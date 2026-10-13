import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ReviewReplyForm } from './ReviewReplyForm';

function setup({
  initialReply = '',
  isPending = false,
  errorMessage = null as string | null,
} = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    withIntl(
      <ReviewReplyForm
        initialReply={initialReply}
        isPending={isPending}
        errorMessage={errorMessage}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    ),
  );
  return { ...utils, onSubmit, onCancel };
}

describe('ReviewReplyForm', () => {
  it('trả lời lần đầu: ô trống, nút "Gửi trả lời", bộ đếm 0/1000, gợi ý rằng câu trả lời công khai và không xoá được', () => {
    setup();

    expect(screen.getByLabelText('Câu trả lời của shop')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Gửi trả lời' })).toBeInTheDocument();
    expect(screen.getByText('0/1000')).toBeInTheDocument();
    expect(screen.getByText(/hiển thị công khai/)).toBeInTheDocument();
    expect(screen.getByText(/không xóa được/)).toBeInTheDocument();
  });

  it('sửa lại: điền sẵn câu trả lời hiện có, nút đổi thành "Lưu thay đổi", bộ đếm theo độ dài thật', () => {
    setup({ initialReply: 'Cảm ơn bạn!' });

    expect(screen.getByLabelText('Câu trả lời của shop')).toHaveValue('Cảm ơn bạn!');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi trả lời' })).not.toBeInTheDocument();
    expect(screen.getByText('11/1000')).toBeInTheDocument();
  });

  it('bộ đếm cập nhật khi gõ', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByLabelText('Câu trả lời của shop'), 'abc');

    expect(screen.getByText('3/1000')).toBeInTheDocument();
  });

  it('gửi: onSubmit nhận câu trả lời đã trim (dạng chuỗi)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.type(screen.getByLabelText('Câu trả lời của shop'), '  Cảm ơn bạn đã ủng hộ  ');
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('Cảm ơn bạn đã ủng hộ');
  });

  it('để trống hoặc chỉ khoảng trắng -> lỗi đã dịch theo field, KHÔNG gọi onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();

    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập nội dung trả lời');
    expect(screen.getByLabelText('Câu trả lời của shop')).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText('Câu trả lời của shop'), '    ');
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Vui lòng nhập nội dung trả lời');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('đúng 1000 ký tự gửi được; 1001 ký tự -> lỗi và KHÔNG gọi onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const field = screen.getByLabelText('Câu trả lời của shop');

    await user.click(field);
    await user.paste('a'.repeat(1001));
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nội dung trả lời tối đa 1000 ký tự',
    );
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(field);
    await user.paste('a'.repeat(1000));
    await user.click(screen.getByRole('button', { name: 'Gửi trả lời' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('đang gửi: khoá cả hai nút, nút chính đổi thành "Đang gửi..."', async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = setup({ initialReply: 'x', isPending: true });

    const submit = screen.getByRole('button', { name: 'Đang gửi...' });
    const cancel = screen.getByRole('button', { name: 'Huỷ' });
    expect(submit).toBeDisabled();
    expect(cancel).toBeDisabled();
    await user.click(submit);
    await user.click(cancel);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('"Huỷ" gọi onCancel mà không gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = setup({ initialReply: 'x' });

    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lỗi của lần gửi trước (errorMessage) hiện ngay trong form dạng role=alert', () => {
    setup({ errorMessage: 'Không thực hiện được thao tác, vui lòng thử lại' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không thực hiện được thao tác, vui lòng thử lại',
    );
  });

  it('câu trả lời 1000 ký tự liền không dấu cách: ô nhập và khối lỗi dùng lưới cột co được, chữ ngắt được', () => {
    const { container } = setup({
      errorMessage: 'x'.repeat(500),
    });

    expect(container.querySelector('form')).toHaveClass('grid-cols-1');
    expect(screen.getByText('x'.repeat(500))).toHaveClass('break-words');
  });
});
