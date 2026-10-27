import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminUserListHeader } from './AdminUserListHeader';
import { AdminUserListSkeleton } from './AdminUserListSkeleton';
import { AdminUsersEmptyState } from './AdminUsersEmptyState';
import { AdminUsersLoadError } from './AdminUsersLoadError';

describe('AdminUsersEmptyState', () => {
  it('tìm theo từ khoá không ra: câu có từ khoá, gợi ý và nút "Xoá bộ lọc" về danh sách gốc', () => {
    render(withIntl(<AdminUsersEmptyState query={{ q: 'nguyen van z', status: 'BANNED' }} />));

    expect(
      screen.getByRole('heading', { name: 'Không có tài khoản khớp “nguyen van z”' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/bỏ bộ lọc vai và trạng thái/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xoá bộ lọc' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
  });

  it('chỉ lọc theo vai mà không ra: câu về bộ lọc (không nhắc từ khoá), có nút xoá', () => {
    render(withIntl(<AdminUsersEmptyState query={{ role: 'ADMIN' }} />));

    expect(
      screen.getByRole('heading', { name: 'Không có tài khoản nào khớp bộ lọc' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xoá bộ lọc' })).toBeInTheDocument();
  });

  it.each([
    ['ACTIVE', 'Chưa có tài khoản nào đang hoạt động.'],
    ['SUSPENDED', 'Chưa có tài khoản nào bị tạm khoá.'],
    ['BANNED', 'Chưa có tài khoản nào bị cấm.'],
    ['DEACTIVATED', 'Chưa có tài khoản nào tự xoá.'],
  ] as const)(
    'tab %s chưa có ai: một câu riêng, KHÔNG có nút xoá bộ lọc (không có gì để bỏ)',
    (status, title) => {
      render(withIntl(<AdminUsersEmptyState query={{ status }} />));

      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Xoá bộ lọc' })).not.toBeInTheDocument();
    },
  );

  it('sàn chưa có người dùng nào (không lọc gì)', () => {
    render(withIntl(<AdminUsersEmptyState query={{}} />));

    expect(screen.getByRole('heading', { name: 'Chưa có người dùng nào.' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('từ khoá chứa HTML chỉ hiện dạng text', () => {
    render(withIntl(<AdminUsersEmptyState query={{ q: '<img src=x onerror=alert(1)>' }} />));

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('bản tiếng Anh: không lộ chuỗi tiếng Việt', () => {
    render(withIntl(<AdminUsersEmptyState query={{ q: 'zzz' }} />, 'en'));

    expect(screen.getByRole('heading', { name: 'No accounts match “zzz”' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toBeInTheDocument();
    expect(screen.queryByText(/Không|Xoá/)).not.toBeInTheDocument();
  });
});

describe('AdminUsersLoadError', () => {
  it('báo lỗi (role=alert) không lộ message của máy chủ và cho thử lại', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(withIntl(<AdminUsersLoadError onRetry={onRetry} />));

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách người dùng.');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AdminUserListSkeleton / AdminUserListHeader', () => {
  it('skeleton chỉ trang trí (aria-hidden), đúng số dòng, và dùng CHUNG dòng tiêu đề với bảng thật', () => {
    const { container } = render(withIntl(<AdminUserListSkeleton count={4} />));

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('ul > li')).toHaveLength(4);
    expect(root.textContent).toContain('Người dùng');
    expect(root.textContent).toContain('Thao tác');
  });

  it('dòng tiêu đề chỉ hiện từ `md`, aria-hidden (mỗi ô dữ liệu đã có nhãn riêng), cột cuối rộng cố định', () => {
    const { container } = render(withIntl(<AdminUserListHeader />));

    const header = container.firstElementChild as HTMLElement;
    expect(header).toHaveAttribute('aria-hidden', 'true');
    expect(header).toHaveClass('hidden', 'md:grid');
    expect(header.className).toContain('11rem');
    expect(header.className).not.toMatch(/\bauto\b/);
  });
});
