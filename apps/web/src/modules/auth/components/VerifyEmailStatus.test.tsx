import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { useAuthStore } from '../store/auth.store';
import { VerifyEmailStatus } from './VerifyEmailStatus';

vi.mock('../services/auth.service', () => ({
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
}));

describe('VerifyEmailStatus', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearUser();
    vi.resetAllMocks();
  });

  it('báo thiếu token nếu không có token trong URL', async () => {
    render(withIntl(<VerifyEmailStatus token={null} />));

    expect(await screen.findByText('Thiếu token xác thực trong đường dẫn')).toBeInTheDocument();
  });

  it('xác thực thành công: hiện message + link đăng nhập (chưa có session)', async () => {
    const { verifyEmail } = await import('../services/auth.service');
    vi.mocked(verifyEmail).mockResolvedValue({ message: 'Xác thực email thành công' });

    render(withIntl(<VerifyEmailStatus token="valid-token" />));

    expect(await screen.findByText('Xác thực email thành công')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
  });

  it('token hết hạn/không hợp lệ, chưa đăng nhập: hiện lỗi + link đăng nhập để gửi lại', async () => {
    const { verifyEmail } = await import('../services/auth.service');
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError('Token xác thực đã hết hạn', 400));

    render(withIntl(<VerifyEmailStatus token="expired-token" />));

    expect(await screen.findByText('Token xác thực đã hết hạn')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Đăng nhập để gửi lại email xác thực' }),
    ).toBeInTheDocument();
  });

  it('token hết hạn nhưng đã đăng nhập: hiện nút gửi lại email xác thực', async () => {
    const { verifyEmail } = await import('../services/auth.service');
    vi.mocked(verifyEmail).mockRejectedValue(new ApiError('Token xác thực đã hết hạn', 400));
    useAuthStore.getState().setUser({
      id: 'user-1',
      email: 'user@example.com',
      name: 'Nguyen Van A',
      role: 'USER',
      emailVerifiedAt: null,
    });

    render(withIntl(<VerifyEmailStatus token="expired-token" />));

    expect(await screen.findByText('Token xác thực đã hết hạn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại email xác thực' })).toBeInTheDocument();
  });

  // Regression: token verify chỉ dùng được 1 lần. React StrictMode chạy mount
  // + effect 2 lần ở dev — nếu không chặn, lần gọi thứ 2 sẽ luôn nhận lỗi
  // "token không hợp lệ" dù lần đầu đã xác thực thành công.
  it('chỉ gọi verifyEmail đúng 1 lần dù StrictMode chạy effect 2 lần', async () => {
    const { verifyEmail } = await import('../services/auth.service');
    vi.mocked(verifyEmail).mockResolvedValue({ message: 'Xác thực email thành công' });

    render(
      withIntl(
        <StrictMode>
          <VerifyEmailStatus token="valid-token" />
        </StrictMode>,
      ),
    );

    await waitFor(() => expect(screen.getByText('Xác thực email thành công')).toBeInTheDocument());
    expect(verifyEmail).toHaveBeenCalledTimes(1);
  });
});
