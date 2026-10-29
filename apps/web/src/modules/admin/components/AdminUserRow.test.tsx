import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeUser, USER_ID } from '../admin-user.fixtures';
import type { AdminUser } from '../types';
import { AdminUserRow } from './AdminUserRow';

const HREF = `/admin/users?u=${USER_ID}`;

function renderRow(user: Partial<AdminUser> = {}, actions?: React.ReactNode) {
  return render(
    withIntl(
      <ul>
        <AdminUserRow user={makeUser(user)} detailHref={HREF} actions={actions} />
      </ul>,
    ),
  );
}

describe('AdminUserRow', () => {
  it('hiện tên (là link mở ngăn chi tiết), email, trạng thái và ngày tham gia', () => {
    renderRow();

    const link = screen.getByRole('link', { name: 'Nguyễn Văn An' });
    expect(link).toHaveAttribute('href', HREF);
    expect(screen.getByRole('heading', { name: 'Nguyễn Văn An' })).toBeInTheDocument();
    expect(screen.getByText('an.nguyen@example.com')).toBeInTheDocument();
    expect(screen.getByText('Hoạt động')).toBeInTheDocument();
    expect(screen.getByText('Tham gia')).toBeInTheDocument();
    const time = screen.getByText(/2026/);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-03-02T08:00:00.000Z');
  });

  it('tài khoản bị khoá: huy hiệu "Tạm khoá", lý do, và cột thời điểm là MỐC BỊ KHOÁ với chú thích "Khoá lúc"', () => {
    renderRow({
      accountStatus: 'SUSPENDED',
      statusReason: 'Bán hàng nhái',
      statusChangedAt: '2026-10-25T10:00:00.000Z',
    });

    expect(screen.getByText('Tạm khoá')).toBeInTheDocument();
    expect(screen.getByText('Lý do: Bán hàng nhái')).toBeInTheDocument();
    expect(screen.getByText('Khoá lúc')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toHaveAttribute('datetime', '2026-10-25T10:00:00.000Z');
    expect(screen.queryByText('Tham gia')).not.toBeInTheDocument();
  });

  it('bị cấm: huy hiệu "Bị cấm" và chú thích "Cấm lúc"', () => {
    renderRow({
      accountStatus: 'BANNED',
      statusReason: 'Lừa đảo',
      statusChangedAt: '2026-10-26T10:00:00.000Z',
    });

    expect(screen.getByText('Bị cấm')).toBeInTheDocument();
    expect(screen.getByText('Cấm lúc')).toBeInTheDocument();
  });

  it('Quản trị viên có nhãn riêng; người dùng thường thì không', () => {
    const { unmount } = renderRow({ role: 'ADMIN' });
    expect(screen.getByText('Quản trị viên')).toBeInTheDocument();
    unmount();

    renderRow({ role: 'USER' });
    expect(screen.queryByText('Quản trị viên')).not.toBeInTheDocument();
  });

  it('email chưa xác thực được nhắc ngay trên dòng; đã xác thực thì không', () => {
    const { unmount } = renderRow({ isEmailVerified: false });
    expect(screen.getByText('Chưa xác thực email')).toBeInTheDocument();
    unmount();

    renderRow({ isEmailVerified: true });
    expect(screen.queryByText('Chưa xác thực email')).not.toBeInTheDocument();
  });

  it('nhãn trường chỉ cho trình đọc màn hình (huy hiệu và chú thích đã tự nói rõ)', () => {
    renderRow();

    expect(screen.getByText('Trạng thái')).toHaveClass('sr-only');
    expect(screen.getByText('Thời điểm')).toHaveClass('sr-only');
  });

  it('chuỗi do người dùng nhập chỉ hiện dạng text, không thành HTML, và tên/email dài bị cắt thay vì làm giãn cột', () => {
    renderRow({
      name: '<img src=x onerror=alert(1)>',
      email: `${'a'.repeat(200)}@example.com`,
      accountStatus: 'BANNED',
      statusReason: '<script>alert(1)</script>',
      statusChangedAt: '2026-10-26T10:00:00.000Z',
    });

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText(`${'a'.repeat(200)}@example.com`)).toHaveClass('truncate');
    expect(screen.getByText(/script/).closest('p')).toHaveClass('line-clamp-2', 'break-words');
  });

  it('lý do đầy đủ nằm ở `title` (dòng chỉ kẹp 2 dòng)', () => {
    renderRow({
      accountStatus: 'SUSPENDED',
      statusReason: 'Lý do rất dài',
      statusChangedAt: '2026-10-25T10:00:00.000Z',
    });

    expect(screen.getByText('Lý do: Lý do rất dài')).toHaveAttribute('title', 'Lý do rất dài');
  });

  it('hiện phần hành động do Container truyền vào; không có thì ô trống tự ẩn (`empty:hidden`)', () => {
    const { unmount } = renderRow({}, <button type="button">Khoá</button>);
    expect(screen.getByRole('button', { name: 'Khoá' })).toBeInTheDocument();
    unmount();

    const { container } = renderRow();
    const cell = container.querySelector('li > div:last-child');
    expect(cell).toBeEmptyDOMElement();
    expect(cell).toHaveClass('empty:hidden');
  });
});
