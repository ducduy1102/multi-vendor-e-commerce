import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { AdminUserRoleFilter } from './AdminUserRoleFilter';
import { AdminUserSearchForm } from './AdminUserSearchForm';
import { AdminUserTabs } from './AdminUserTabs';

describe('AdminUserTabs', () => {
  function renderTabs(query: Parameters<typeof AdminUserTabs>[0]['query']) {
    render(withIntl(<AdminUserTabs query={query} />));
    return within(screen.getByRole('navigation', { name: 'Lọc người dùng theo trạng thái' }));
  }

  it('đủ 5 tab: Tất cả (mặc định, không cần ?status=) rồi bốn trạng thái, đúng thứ tự', () => {
    const nav = renderTabs({});

    expect(
      nav.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Tất cả', '/admin/users'],
      ['Hoạt động', '/admin/users?status=ACTIVE'],
      ['Tạm khoá', '/admin/users?status=SUSPENDED'],
      ['Bị cấm', '/admin/users?status=BANNED'],
      ['Đã tự xoá', '/admin/users?status=DEACTIVATED'],
    ]);
  });

  it('đổi tab GIỮ vai và từ khoá đang dùng, về trang 1 và đóng ngăn chi tiết', () => {
    const nav = renderTabs({ status: 'ACTIVE', role: 'ADMIN', q: 'an' });

    expect(nav.getByRole('link', { name: 'Bị cấm' })).toHaveAttribute(
      'href',
      '/admin/users?status=BANNED&role=ADMIN&q=an',
    );
    expect(nav.getByRole('link', { name: 'Tất cả' })).toHaveAttribute(
      'href',
      '/admin/users?role=ADMIN&q=an',
    );
  });

  it('chỉ đúng một tab là tab hiện tại: "Tất cả" khi không lọc, ngược lại là tab trạng thái đang lọc', () => {
    const { unmount } = render(withIntl(<AdminUserTabs query={{}} />));
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent),
    ).toEqual(['Tất cả']);
    unmount();

    render(withIntl(<AdminUserTabs query={{ status: 'BANNED' }} />));
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent),
    ).toEqual(['Bị cấm']);
  });
});

describe('AdminUserRoleFilter', () => {
  it('ba lựa chọn Tất cả vai / Người dùng / Quản trị viên; đổi vai giữ trạng thái và từ khoá', () => {
    render(withIntl(<AdminUserRoleFilter query={{ status: 'SUSPENDED', q: 'an' }} />));

    const nav = within(screen.getByRole('navigation', { name: 'Lọc theo vai' }));
    expect(
      nav.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Tất cả vai', '/admin/users?status=SUSPENDED&q=an'],
      ['Người dùng', '/admin/users?status=SUSPENDED&role=USER&q=an'],
      ['Quản trị viên', '/admin/users?status=SUSPENDED&role=ADMIN&q=an'],
    ]);
  });

  it('đánh dấu đúng lựa chọn hiện tại bằng aria-current', () => {
    render(withIntl(<AdminUserRoleFilter query={{ role: 'ADMIN' }} />));

    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'true')
        .map((link) => link.textContent),
    ).toEqual(['Quản trị viên']);
  });
});

describe('AdminUserSearchForm', () => {
  function setup(appliedQuery = '') {
    const onSearch = vi.fn<(query: string) => void>();
    render(
      withIntl(
        <AdminUserSearchForm
          appliedQuery={appliedQuery}
          onSearch={onSearch}
          clearHref="/admin/users?status=BANNED"
        />,
      ),
    );
    return { onSearch };
  }

  it('Enter gửi từ khoá đã cắt khoảng trắng hai đầu', async () => {
    const user = userEvent.setup();
    const { onSearch } = setup();

    await user.type(
      screen.getByRole('textbox', { name: 'Tìm theo email hoặc tên' }),
      '  an  {Enter}',
    );

    expect(onSearch).toHaveBeenCalledExactlyOnceWith('an');
  });

  it('gửi ô trống = bỏ tìm (chuỗi rỗng)', async () => {
    const user = userEvent.setup();
    const { onSearch } = setup('an');

    await user.clear(screen.getByRole('textbox', { name: 'Tìm theo email hoặc tên' }));
    await user.keyboard('{Enter}');

    expect(onSearch).toHaveBeenCalledExactlyOnceWith('');
  });

  it('không tự tìm theo từng phím gõ', async () => {
    const user = userEvent.setup();
    const { onSearch } = setup();

    await user.type(screen.getByRole('textbox', { name: 'Tìm theo email hoặc tên' }), 'nguyen');

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('khởi tạo từ từ khoá đang áp dụng và có nút xoá (link giữ các bộ lọc khác); không có từ khoá thì không có nút xoá', () => {
    setup('nguyen');

    expect(screen.getByRole('textbox', { name: 'Tìm theo email hoặc tên' })).toHaveValue('nguyen');
    expect(screen.getByRole('link', { name: 'Xoá từ khoá' })).toHaveAttribute(
      'href',
      '/admin/users?status=BANNED',
    );
  });

  it('không có từ khoá áp dụng -> không có nút xoá', () => {
    setup('');

    expect(screen.queryByRole('link', { name: 'Xoá từ khoá' })).not.toBeInTheDocument();
  });

  it('giới hạn độ dài ô nhập bằng đúng hằng của BE', () => {
    setup();

    expect(screen.getByRole('textbox', { name: 'Tìm theo email hoặc tên' })).toHaveAttribute(
      'maxlength',
      '254',
    );
  });
});
