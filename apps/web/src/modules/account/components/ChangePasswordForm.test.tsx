import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ChangePasswordForm } from './ChangePasswordForm';

const SUBMIT = { name: 'Đổi mật khẩu' };

function setup(props: Partial<React.ComponentProps<typeof ChangePasswordForm>> = {}) {
  const onSubmit = vi.fn();
  render(withIntl(<ChangePasswordForm onSubmit={onSubmit} {...props} />));
  return { onSubmit };
}

async function fill(current: string, next: string, confirm: string) {
  const user = userEvent.setup();
  if (current) await user.type(screen.getByLabelText('Mật khẩu hiện tại'), current);
  if (next) await user.type(screen.getByLabelText('Mật khẩu mới'), next);
  if (confirm) await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), confirm);
  await user.click(screen.getByRole('button', SUBMIT));
}

describe('ChangePasswordForm', () => {
  it('để trống -> báo lỗi từng ô, KHÔNG gọi onSubmit', async () => {
    const { onSubmit } = setup();

    await fill('', '', '');

    expect(await screen.findByText('Vui lòng nhập mật khẩu')).toBeInTheDocument();
    expect(screen.getByText('Mật khẩu tối thiểu 8 ký tự')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập lại mật khẩu')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('mật khẩu mới trùng mật khẩu hiện tại -> lỗi ở ô mật khẩu mới', async () => {
    const { onSubmit } = setup();

    await fill('same-password-1', 'same-password-1', 'same-password-1');

    expect(await screen.findByText('Mật khẩu mới phải khác mật khẩu hiện tại')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nhập lại không khớp -> lỗi ở ô nhập lại', async () => {
    const { onSubmit } = setup();

    await fill('old-password-1', 'new-password-2', 'new-password-3');

    expect(await screen.findByText('Mật khẩu nhập lại không khớp')).toBeInTheDocument();
    expect(screen.getByLabelText('Nhập lại mật khẩu mới')).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hợp lệ -> onSubmit nhận cả 3 giá trị (Container tự lược ô nhập lại trước khi gọi API)', async () => {
    const { onSubmit } = setup();

    await fill('old-password-1', 'new-password-2', 'new-password-2');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual({
      currentPassword: 'old-password-1',
      newPassword: 'new-password-2',
      confirmPassword: 'new-password-2',
    });
  });

  it('lỗi do BE cho riêng ô mật khẩu hiện tại hiện NGAY DƯỚI ô đó, đánh dấu aria-invalid', () => {
    setup({ currentPasswordError: 'Mật khẩu hiện tại không đúng' });

    const field = screen.getByLabelText('Mật khẩu hiện tại');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const message = screen.getByText('Mật khẩu hiện tại không đúng');
    expect(field.getAttribute('aria-describedby')).toBe(message.id);
  });

  it('không có lỗi -> ô mật khẩu hiện tại không bị đánh dấu sai', () => {
    setup();

    expect(screen.getByLabelText('Mật khẩu hiện tại')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('cả 3 ô là kiểu password với autocomplete đúng (trình quản lý mật khẩu nhận diện được)', () => {
    setup();

    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Nhập lại mật khẩu mới')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });

  it('đang gửi -> nút đổi chữ và bị vô hiệu', () => {
    setup({ isSubmitting: true });

    expect(screen.getByRole('button', { name: 'Đang lưu...' })).toBeDisabled();
  });
});
