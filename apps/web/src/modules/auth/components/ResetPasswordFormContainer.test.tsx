import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { me, resetPassword } from '../services/auth.service';
import { useAuthStore } from '../store/auth.store';
import type { AuthUser } from '../types';
import { ResetPasswordFormContainer } from './ResetPasswordFormContainer';

const { push, toast } = vi.hoisted(() => ({
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast }));
// Chỉ thay useRouter — giữ Link thật vì ResetPasswordLinkInvalid dùng nó.
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  useRouter: () => ({ push }),
}));
vi.mock('../services/auth.service', () => ({
  resetPassword: vi.fn(),
  me: vi.fn(),
}));

const TOKEN = 'tok-bi-mat-1234567890';
const NEW_PASSWORD = 'password-moi-1';

const googleOnlyUser: AuthUser = {
  id: 'user-1',
  email: 'google@example.com',
  name: 'Google User',
  role: 'USER',
  emailVerifiedAt: null,
  locale: 'vi',
  hasPassword: false,
};

async function submitNewPassword() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Mật khẩu mới'), NEW_PASSWORD);
  await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), NEW_PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Đặt lại mật khẩu' }));
}

// Chờ hết việc đang treo rồi mới khẳng định điều "KHÔNG xảy ra" (rules/frontend.md mục 8): mutation chỉ
// gọi service sau vài microtask nên assert ngay sau thao tác đồng bộ luôn đúng, kể cả khi code sai.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('ResetPasswordFormContainer', () => {
  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearUser();
    vi.resetAllMocks();
  });

  it('thiếu token: hiện thông báo + đường xin liên kết mới, không có form', () => {
    render(withIntl(<ResetPasswordFormContainer token={null} />));

    expect(screen.getByRole('alert')).toHaveTextContent('thiếu mã xác thực');
    expect(screen.getByRole('button', { name: 'Yêu cầu liên kết mới' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByLabelText('Mật khẩu mới')).not.toBeInTheDocument();
  });

  it('thành công: gửi token + mật khẩu mới (KHÔNG gửi ô nhập lại), toast rồi chuyển /login', async () => {
    vi.mocked(resetPassword).mockResolvedValue({ message: 'ok' });
    render(withIntl(<ResetPasswordFormContainer token={TOKEN} />));

    await submitNewPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));

    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(resetPassword).toHaveBeenCalledWith({ token: TOKEN, newPassword: NEW_PASSWORD });
    expect(toast.success).toHaveBeenCalledWith(
      'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới',
    );
    // Chưa đăng nhập ⇒ không hỏi lại /auth/me.
    expect(me).not.toHaveBeenCalled();
  });

  it('token bị BE từ chối (RESET_TOKEN_INVALID): thay form bằng thông báo + xin liên kết mới, không chuyển trang', async () => {
    vi.mocked(resetPassword).mockRejectedValue(
      new ApiError('Invalid or expired token', 400, 'RESET_TOKEN_INVALID'),
    );
    render(withIntl(<ResetPasswordFormContainer token={TOKEN} />));

    await submitNewPassword();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn',
    );
    expect(screen.getByRole('button', { name: 'Yêu cầu liên kết mới' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByLabelText('Mật khẩu mới')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // Token là bí mật dùng một lần: không bao giờ hiện lại ra giao diện.
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('lỗi khác (mất mạng…): câu chung đã dịch, GIỮ form để thử lại, không chuyển trang', async () => {
    vi.mocked(resetPassword).mockRejectedValue(new ApiError('Network error', 0, 'NETWORK_ERROR'));
    render(withIntl(<ResetPasswordFormContainer token={TOKEN} />));

    await submitNewPassword();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không đặt lại được mật khẩu, vui lòng thử lại sau',
    );
    expect(screen.queryByText(/Network error/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu mới')).toBeInTheDocument();
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('đang đăng nhập (tài khoản Google đặt mật khẩu lần đầu): làm mới user trong store để hasPassword đúng', async () => {
    vi.mocked(resetPassword).mockResolvedValue({ message: 'ok' });
    vi.mocked(me).mockResolvedValue({ ...googleOnlyUser, hasPassword: true });
    useAuthStore.getState().setUser(googleOnlyUser);
    render(withIntl(<ResetPasswordFormContainer token={TOKEN} />));

    await submitNewPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));

    expect(me).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user?.hasPassword).toBe(true);
  });

  it('đang đăng nhập nhưng /auth/me lỗi: việc đặt mật khẩu đã xong nên vẫn toast + chuyển trang', async () => {
    vi.mocked(resetPassword).mockResolvedValue({ message: 'ok' });
    vi.mocked(me).mockRejectedValue(new ApiError('Unauthorized', 401));
    useAuthStore.getState().setUser(googleOnlyUser);
    render(withIntl(<ResetPasswordFormContainer token={TOKEN} />));

    await submitNewPassword();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));

    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
