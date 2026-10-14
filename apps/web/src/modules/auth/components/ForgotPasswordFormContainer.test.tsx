import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { forgotPassword } from '../services/auth.service';
import { ForgotPasswordFormContainer } from './ForgotPasswordFormContainer';

vi.mock('../services/auth.service', () => ({
  forgotPassword: vi.fn(),
}));

async function submitEmail(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));
  return user;
}

describe('ForgotPasswordFormContainer', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('gọi API với email đã chuẩn hoá rồi hiện thông báo TRUNG TÍNH kèm chính email vừa gõ', async () => {
    vi.mocked(forgotPassword).mockResolvedValue({ message: 'BE-MESSAGE-KHONG-DUOC-HIEN' });
    render(withIntl(<ForgotPasswordFormContainer />));

    await submitEmail(' User@Example.com ');

    const status = await screen.findByRole('status');
    expect(forgotPassword).toHaveBeenCalledWith({ email: 'user@example.com' });
    // Câu "Nếu … đã đăng ký tài khoản" — không khẳng định tài khoản có tồn tại.
    expect(status).toHaveTextContent('Nếu user@example.com đã đăng ký tài khoản');
    // Chữ hiện ra là bản dịch của FE, không phải message thô của BE.
    expect(screen.queryByText(/BE-MESSAGE-KHONG-DUOC-HIEN/)).not.toBeInTheDocument();
    // Form biến mất: không còn gì để gửi lại ngoài nút "Dùng email khác" — câu hướng dẫn nhập email cũng
    // không còn nằm trên thông báo đã gửi.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nhập email đã đăng ký/)).not.toBeInTheDocument();
  });

  it('lỗi mạng/5xx: câu chung đã dịch, không in message thô của BE, form vẫn còn để thử lại', async () => {
    vi.mocked(forgotPassword).mockRejectedValue(new ApiError('Network error', 0, 'NETWORK_ERROR'));
    render(withIntl(<ForgotPasswordFormContainer />));

    await submitEmail('user@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không gửi được yêu cầu, vui lòng thử lại sau',
    );
    expect(screen.queryByText(/Network error/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('"Dùng email khác" đưa về form trống', async () => {
    vi.mocked(forgotPassword).mockResolvedValue({ message: 'ok' });
    render(withIntl(<ForgotPasswordFormContainer />));
    const user = await submitEmail('user@example.com');

    await user.click(await screen.findByRole('button', { name: 'Dùng email khác' }));

    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('luôn có đường quay lại đăng nhập, cả trước lẫn sau khi gửi', async () => {
    vi.mocked(forgotPassword).mockResolvedValue({ message: 'ok' });
    render(withIntl(<ForgotPasswordFormContainer />));

    expect(screen.getByRole('link', { name: 'Quay lại đăng nhập' })).toHaveAttribute(
      'href',
      '/login',
    );

    await submitEmail('user@example.com');
    await screen.findByRole('status');

    expect(screen.getByRole('link', { name: 'Quay lại đăng nhập' })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
