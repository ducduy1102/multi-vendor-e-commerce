import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/modules/auth';
import { ApiError } from '@/shared/lib/api-client';
import { withIntl } from '@/shared/lib/test-i18n';

import { updateProfile } from '../services/account.service';
import { ProfileFormContainer } from './ProfileFormContainer';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('sonner', () => ({ toast }));
vi.mock('../services/account.service', () => ({
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
}));

const user = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Tên cũ',
  role: 'USER' as const,
  emailVerifiedAt: '2026-10-01T00:00:00.000Z',
  locale: 'vi' as const,
  hasPassword: true,
};

function renderContainer() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    withIntl(
      <QueryClientProvider client={client}>
        <ProfileFormContainer />
      </QueryClientProvider>,
    ),
  );
}

describe('ProfileFormContainer', () => {
  beforeEach(() => {
    vi.mocked(updateProfile).mockReset();
    toast.success.mockReset();
    useAuthStore.setState({ user, isHydrating: false });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ user: null, isHydrating: true });
  });

  it('đang xác định đăng nhập (isHydrating) -> skeleton, chưa hiện form hay thông báo "cần đăng nhập"', () => {
    useAuthStore.setState({ user: null, isHydrating: true });
    const { container } = renderContainer();

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText('Họ và tên')).not.toBeInTheDocument();
    expect(screen.queryByText(/chưa đăng nhập/)).not.toBeInTheDocument();
  });

  it('chắc chắn chưa có user (cookie hết hạn) -> báo cần đăng nhập, link kèm next=/account', () => {
    useAuthStore.setState({ user: null, isHydrating: false });
    renderContainer();

    expect(screen.getByRole('alert')).toHaveTextContent('Vui lòng đăng nhập');
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toHaveAttribute(
      'href',
      '/login?next=%2Faccount',
    );
  });

  it('có user -> form điền sẵn tên và ngôn ngữ, email chỉ đọc', () => {
    renderContainer();

    expect(screen.getByLabelText('Họ và tên')).toHaveValue('Tên cũ');
    expect(screen.getByLabelText('Ngôn ngữ email')).toHaveValue('vi');
    expect(screen.getByLabelText('Email')).toHaveValue('user@example.com');
    expect(screen.getByText('Đã xác thực')).toBeInTheDocument();
  });

  it('user chưa xác thực email -> huy hiệu "Chưa xác thực" kèm nút gửi lại', () => {
    useAuthStore.setState({ user: { ...user, emailVerifiedAt: null } });
    renderContainer();

    expect(screen.getByText('Chưa xác thực')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gửi lại email xác thực' })).toBeInTheDocument();
  });

  it('lưu thành công -> gọi API đúng 2 field, store có user MỚI (Header đổi tên ngay), toast', async () => {
    const userEv = userEvent.setup();
    vi.mocked(updateProfile).mockResolvedValue({ ...user, name: 'Tên mới', locale: 'en' });
    renderContainer();

    const name = screen.getByLabelText('Họ và tên');
    await userEv.clear(name);
    await userEv.type(name, 'Tên mới');
    await userEv.selectOptions(screen.getByLabelText('Ngôn ngữ email'), 'en');
    await userEv.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã lưu hồ sơ'));
    expect(updateProfile).toHaveBeenCalledWith({ name: 'Tên mới', locale: 'en' });
    expect(useAuthStore.getState().user).toMatchObject({ name: 'Tên mới', locale: 'en' });
  });

  it('lưu lỗi -> câu chung đã dịch (không in message BE), store giữ user cũ, không toast thành công', async () => {
    const userEv = userEvent.setup();
    vi.mocked(updateProfile).mockRejectedValue(new ApiError('Internal server error', 500));
    renderContainer();

    await userEv.type(screen.getByLabelText('Họ và tên'), ' sửa');
    await userEv.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không lưu được hồ sơ');
    expect(screen.queryByText(/Internal server error/)).not.toBeInTheDocument();
    expect(useAuthStore.getState().user).toMatchObject({ name: 'Tên cũ' });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
