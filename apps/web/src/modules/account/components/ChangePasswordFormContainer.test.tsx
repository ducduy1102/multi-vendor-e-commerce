import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { changePassword } from '../services/account.service';
import { ChangePasswordFormContainer } from './ChangePasswordFormContainer';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('sonner', () => ({ toast }));
vi.mock('../services/account.service', () => ({
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
}));

const user = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Nguyễn Văn A',
  role: 'USER' as const,
  emailVerifiedAt: null,
  locale: 'vi' as const,
  hasPassword: true,
};

function renderContainer() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    withIntl(
      <QueryClientProvider client={client}>
        <ChangePasswordFormContainer />
      </QueryClientProvider>,
    ),
  );
}

async function submit(current = 'old-password-1', next = 'new-password-2') {
  const userEv = userEvent.setup();
  await userEv.type(screen.getByLabelText('Mật khẩu hiện tại'), current);
  await userEv.type(screen.getByLabelText('Mật khẩu mới'), next);
  await userEv.type(screen.getByLabelText('Nhập lại mật khẩu mới'), next);
  await userEv.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
}

describe('ChangePasswordFormContainer', () => {
  beforeEach(() => {
    vi.mocked(changePassword).mockReset();
    toast.success.mockReset();
    useAuthStore.setState({ user, isHydrating: false });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ user: null, isHydrating: true });
  });

  it('đang xác định đăng nhập -> skeleton, chưa quyết định "đổi" hay "đặt" mật khẩu', () => {
    useAuthStore.setState({ user: null, isHydrating: true });
    const { container } = renderContainer();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText('Mật khẩu hiện tại')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đặt mật khẩu' })).not.toBeInTheDocument();
  });

  it('chưa có user (cookie hết hạn) -> báo cần đăng nhập, link kèm next=/account/password', () => {
    useAuthStore.setState({ user: null, isHydrating: false });
    renderContainer();

    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toHaveAttribute(
      'href',
      '/login?next=%2Faccount%2Fpassword',
    );
  });

  it('tài khoản CÓ mật khẩu -> form đổi mật khẩu, không có khối "Đặt mật khẩu"', () => {
    renderContainer();

    expect(screen.getByLabelText('Mật khẩu hiện tại')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đặt mật khẩu' })).not.toBeInTheDocument();
  });

  it('tài khoản KHÔNG có mật khẩu (chỉ Google) -> khối "Đặt mật khẩu" dẫn /forgot-password, không có form đổi', () => {
    useAuthStore.setState({ user: { ...user, hasPassword: false } });
    renderContainer();

    expect(screen.getByRole('button', { name: 'Đặt mật khẩu' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByLabelText('Mật khẩu hiện tại')).not.toBeInTheDocument();
  });

  it('đổi thành công -> gửi ĐÚNG 2 field (không gửi ô nhập lại), toast, form được xoá sạch', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    renderContainer();

    await submit();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã đổi mật khẩu'));
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password-1',
      newPassword: 'new-password-2',
    });
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveValue('');
    expect(screen.getByLabelText('Mật khẩu mới')).toHaveValue('');
    expect(screen.getByLabelText('Nhập lại mật khẩu mới')).toHaveValue('');
  });

  it('sai mật khẩu hiện tại (CURRENT_PASSWORD_INCORRECT) -> lỗi ngay dưới ô đó, giữ nguyên form', async () => {
    vi.mocked(changePassword).mockRejectedValue(
      new ApiError('The current password is incorrect', 400, 'CURRENT_PASSWORD_INCORRECT'),
    );
    renderContainer();

    await submit();

    expect(await screen.findByText('Mật khẩu hiện tại không đúng')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveAttribute('aria-invalid', 'true');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('BE báo chưa có mật khẩu (PASSWORD_NOT_SET, store cũ) -> chuyển sang khối "Đặt mật khẩu"', async () => {
    vi.mocked(changePassword).mockRejectedValue(
      new ApiError('no password', 400, 'PASSWORD_NOT_SET'),
    );
    renderContainer();

    await submit();

    expect(await screen.findByRole('button', { name: 'Đặt mật khẩu' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(useAuthStore.getState().user?.hasPassword).toBe(false);
    expect(screen.queryByLabelText('Mật khẩu hiện tại')).not.toBeInTheDocument();
  });

  it('lỗi khác (mất mạng, 5xx) -> câu chung đã dịch, không in message BE', async () => {
    vi.mocked(changePassword).mockRejectedValue(new ApiError('Network error', 0, 'NETWORK_ERROR'));
    renderContainer();

    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Không đổi được mật khẩu');
    expect(screen.queryByText(/Network error/)).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
