import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';
import { REVIEW_COMMENT_MAX_LENGTH } from '../schemas/review.schema';
import type { ReviewFormInput } from '../types';
import { ReviewForm } from './ReviewForm';

type Props = Parameters<typeof ReviewForm>[0];

function renderForm(props: Partial<Props> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    withIntl(
      <ReviewForm
        mode="create"
        isSubmitting={false}
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...props}
      />,
    ),
  );
  const rerenderForm = (next: Partial<Props>) =>
    utils.rerender(
      withIntl(
        <ReviewForm
          mode="create"
          isSubmitting={false}
          onSubmit={onSubmit}
          onCancel={onCancel}
          {...props}
          {...next}
        />,
      ),
    );
  return { ...utils, onSubmit, onCancel, rerenderForm };
}

const textarea = () => screen.getByRole('textbox', { name: /Nhận xét/ });
const submitButton = (name = 'Gửi đánh giá') => screen.getByRole('button', { name });

describe('ReviewForm', () => {
  it('viết mới: có nhóm chọn sao, ô nhận xét, nút gửi và nút huỷ; chưa chọn sao nào', () => {
    renderForm();

    expect(screen.getByRole('radiogroup', { name: 'Số sao của bạn' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(textarea()).toHaveValue('');
    expect(submitButton()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeEnabled();
  });

  it('chưa chọn sao mà gửi -> lỗi tại nhóm sao (aria-invalid + liên kết mô tả), KHÔNG gọi onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Vui lòng chọn số sao');
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAttribute('aria-describedby', alert.id);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('chọn sao + nhận xét -> onSubmit nhận { rating, comment } đã trim', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('radio', { name: '4 sao' }));
    await user.type(textarea(), '  Áo đẹp, giao nhanh  ');
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ rating: 4, comment: 'Áo đẹp, giao nhanh' });
  });

  it('nhận xét bỏ trống ("" từ ô nhập) -> gửi comment undefined, không lọt chuỗi rỗng', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('radio', { name: '5 sao' }));
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith({ rating: 5, comment: undefined });
  });

  it('bàn phím: chọn sao bằng mũi tên rồi Enter ở ô gửi vẫn gửi đúng số sao', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.tab();
    expect(screen.getByRole('radio', { name: '1 sao' })).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByRole('radio', { name: '3 sao' })).toBeChecked();
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith({ rating: 3, comment: undefined });
  });

  it('bộ đếm theo độ dài đang gõ ("0/1000" → "5/1000")', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByText('0/1000')).toBeInTheDocument();
    await user.type(textarea(), 'Tuyệt');

    expect(screen.getByText('5/1000')).toBeInTheDocument();
    expect(screen.getByText('5/1000')).toHaveClass('text-muted-foreground');
    // Bộ đếm được liên kết với ô nhận xét cho trình đọc màn hình.
    expect(textarea().getAttribute('aria-describedby')).toContain(
      screen.getByText('5/1000').getAttribute('id'),
    );
  });

  it('nhận xét vượt 1000 ký tự: bộ đếm đổi sang màu lỗi, gửi bị chặn và hiện lỗi tại ô nhận xét', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('radio', { name: '2 sao' }));
    // paste thay vì type 1001 lần để test nhanh.
    await user.click(textarea());
    await user.paste('a'.repeat(REVIEW_COMMENT_MAX_LENGTH + 1));
    expect(screen.getByText('1001/1000')).toHaveClass('text-destructive');

    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Nhận xét tối đa 1000 ký tự');
    expect(textarea()).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('đúng 1000 ký tự vẫn gửi được', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.click(screen.getByRole('radio', { name: '5 sao' }));
    await user.click(textarea());
    await user.paste('a'.repeat(REVIEW_COMMENT_MAX_LENGTH));
    await user.click(submitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('đang gửi: nút gửi đổi nhãn + khoá, mọi ô và nút huỷ khoá, bấm không gọi onSubmit lần nữa', async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderForm({ isSubmitting: true });

    const submit = screen.getByRole('button', { name: 'Đang gửi...' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();
    expect(textarea()).toBeDisabled();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();

    await user.click(submit);
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('bấm huỷ -> gọi onCancel, không gửi', async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Huỷ' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lỗi từ API (đã dịch) hiện ở đầu form dạng cảnh báo', () => {
    renderForm({ errorMessage: 'Bạn chưa thể đánh giá sản phẩm này' });

    expect(screen.getByText('Bạn chưa thể đánh giá sản phẩm này')).toBeInTheDocument();
  });

  describe('sửa đánh giá', () => {
    const OLD: ReviewFormInput = { rating: 3, comment: 'Tạm ổn' };

    it('điền sẵn sao + nhận xét cũ, nút gửi đổi thành "Lưu thay đổi"', () => {
      renderForm({ mode: 'edit', initialValues: OLD });

      expect(screen.getByRole('radio', { name: '3 sao' })).toBeChecked();
      expect(textarea()).toHaveValue('Tạm ổn');
      expect(screen.getByText('6/1000')).toBeInTheDocument();
      expect(submitButton('Lưu thay đổi')).toBeInTheDocument();
    });

    it('dữ liệu tới BẤT ĐỒNG BỘ (mount chưa có, sau mới có): form tự điền lại nhờ option `values`', async () => {
      const { rerenderForm } = renderForm({ mode: 'edit', initialValues: undefined });
      expect(
        screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked),
      ).toBe(true);
      expect(textarea()).toHaveValue('');

      rerenderForm({ initialValues: OLD });

      expect(await screen.findByDisplayValue('Tạm ổn')).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '3 sao' })).toBeChecked();
    });

    it('sửa rồi lưu -> onSubmit nhận giá trị mới (gửi ĐỦ rating + comment)', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm({ mode: 'edit', initialValues: OLD });

      await user.click(screen.getByRole('radio', { name: '5 sao' }));
      await user.clear(textarea());
      await user.type(textarea(), 'Dùng lâu thấy rất tốt');
      await user.click(submitButton('Lưu thay đổi'));

      expect(onSubmit).toHaveBeenCalledWith({ rating: 5, comment: 'Dùng lâu thấy rất tốt' });
    });

    it('xoá hết nhận xét cũ rồi lưu -> comment undefined (người dùng bỏ nhận xét)', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm({ mode: 'edit', initialValues: OLD });

      await user.clear(textarea());
      await user.click(submitButton('Lưu thay đổi'));

      expect(onSubmit).toHaveBeenCalledWith({ rating: 3, comment: undefined });
    });

    it('đánh giá cũ không có nhận xét (null → undefined) -> ô nhận xét trống, vẫn lưu được', async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm({
        mode: 'edit',
        initialValues: { rating: 4, comment: undefined },
      });

      expect(textarea()).toHaveValue('');
      await user.click(submitButton('Lưu thay đổi'));

      expect(onSubmit).toHaveBeenCalledWith({ rating: 4, comment: undefined });
    });
  });
});
