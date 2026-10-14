import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { ForgotPasswordForm } from './ForgotPasswordForm';

describe('ForgotPasswordForm', () => {
  it('báo lỗi theo field và không gọi onSubmit khi để trống', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<ForgotPasswordForm onSubmit={onSubmit} />));

    await user.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('email sai định dạng bị chặn trước khi gửi', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<ForgotPasswordForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Email'), 'khong-phai-email');
    await user.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('gửi email đã chuẩn hoá (cắt khoảng trắng, chữ thường) cùng schema với BE', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(withIntl(<ForgotPasswordForm onSubmit={onSubmit} />));

    await user.type(screen.getByLabelText('Email'), '  User@Example.com ');
    await user.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ email: 'user@example.com' }, expect.anything()),
    );
  });

  it('khoá nút gửi khi đang gửi', () => {
    render(withIntl(<ForgotPasswordForm onSubmit={vi.fn()} isSubmitting />));

    expect(screen.getByRole('button', { name: 'Đang gửi...' })).toBeDisabled();
  });
});
