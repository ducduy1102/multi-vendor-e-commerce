import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import type { AdminUserAction } from '../admin-user-actions';
import type { AccountStatus } from '../types';
import { AdminUserActions } from './AdminUserActions';

function setup({
  accountStatus = 'ACTIVE' as AccountStatus,
  role = 'USER' as 'USER' | 'ADMIN',
  isDisabled = false,
  layout = 'row' as 'row' | 'sheet',
} = {}) {
  const onAction = vi.fn<(action: AdminUserAction) => void>();
  const utils = render(
    withIntl(
      <AdminUserActions
        user={{ name: 'Nguyễn Văn An', role, accountStatus }}
        layout={layout}
        isDisabled={isDisabled}
        onAction={onAction}
      />,
    ),
  );
  return { ...utils, onAction };
}

describe('AdminUserActions — hàng trong bảng', () => {
  it('tài khoản đang hoạt động: nút "Khoá" trên dòng; "Cấm tài khoản" KHÔNG hiện sẵn mà nằm trong menu `…`', async () => {
    const user = userEvent.setup();
    const { onAction } = setup({ accountStatus: 'ACTIVE' });

    expect(screen.getByRole('button', { name: 'Khoá: Nguyễn Văn An' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Cấm tài khoản/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Thêm hành động cho Nguyễn Văn An' }));
    await user.click(await screen.findByRole('menuitem', { name: /Cấm tài khoản/ }));

    expect(onAction).toHaveBeenCalledWith('ban');
  });

  it('tạm khoá: "Mở lại" trên dòng và "Cấm tài khoản" trong menu', async () => {
    const user = userEvent.setup();
    const { onAction } = setup({ accountStatus: 'SUSPENDED' });

    await user.click(screen.getByRole('button', { name: 'Mở lại: Nguyễn Văn An' }));
    expect(onAction).toHaveBeenCalledWith('reactivate');

    await user.click(screen.getByRole('button', { name: 'Thêm hành động cho Nguyễn Văn An' }));
    expect(await screen.findByRole('menuitem', { name: /Cấm tài khoản/ })).toBeInTheDocument();
  });

  it('bị cấm: chỉ có "Gỡ cấm" (không có menu `…`, không có "Khoá"/"Mở lại")', async () => {
    const user = userEvent.setup();
    const { onAction } = setup({ accountStatus: 'BANNED' });

    expect(
      screen.queryByRole('button', { name: 'Thêm hành động cho Nguyễn Văn An' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Khoá/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Mở lại/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gỡ cấm: Nguyễn Văn An' }));
    expect(onAction).toHaveBeenCalledWith('unban');
  });

  it('Quản trị viên và tài khoản đã tự xoá: không vẽ gì (không nút khoá/cấm nào)', () => {
    const admin = setup({ accountStatus: 'ACTIVE', role: 'ADMIN' });
    expect(admin.container).toBeEmptyDOMElement();
    admin.unmount();

    const deactivated = setup({ accountStatus: 'DEACTIVATED' });
    expect(deactivated.container).toBeEmptyDOMElement();
  });

  it('đang có hành động chạy -> khoá cả nút lẫn menu (không gửi trùng)', () => {
    setup({ accountStatus: 'ACTIVE', isDisabled: true });

    expect(screen.getByRole('button', { name: 'Khoá: Nguyễn Văn An' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Thêm hành động cho Nguyễn Văn An' })).toBeDisabled();
  });
});

describe('AdminUserActions — chân ngăn chi tiết', () => {
  it('mọi hành động là nút rõ ràng (không phải tìm trong menu): Khoá + Cấm tài khoản', async () => {
    const user = userEvent.setup();
    const { onAction } = setup({ accountStatus: 'ACTIVE', layout: 'sheet' });

    expect(
      screen.queryByRole('button', { name: 'Thêm hành động cho Nguyễn Văn An' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cấm tài khoản: Nguyễn Văn An' }));
    expect(onAction).toHaveBeenCalledWith('ban');

    await user.click(screen.getByRole('button', { name: 'Khoá: Nguyễn Văn An' }));
    expect(onAction).toHaveBeenCalledWith('suspend');
  });

  it('bị cấm: chỉ "Gỡ cấm"; Quản trị viên: không có gì', () => {
    const banned = setup({ accountStatus: 'BANNED', layout: 'sheet' });
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Gỡ cấm']);
    banned.unmount();

    const admin = setup({ accountStatus: 'SUSPENDED', role: 'ADMIN', layout: 'sheet' });
    expect(admin.container).toBeEmptyDOMElement();
  });
});
