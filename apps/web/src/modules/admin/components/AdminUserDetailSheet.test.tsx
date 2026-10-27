import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeDetail } from '../admin-user.fixtures';
import type { AdminUserDetailState } from '../admin-user-detail-state';
import type { AdminUserDetail } from '../types';
import { AdminUserDetailSheet } from './AdminUserDetailSheet';

function setup(
  state: AdminUserDetailState,
  { actions = null as React.ReactNode, locale = 'vi' as 'vi' | 'en' } = {},
) {
  const onOpenChange = vi.fn();
  const onRetry = vi.fn();
  const utils = render(
    withIntl(
      <AdminUserDetailSheet
        open
        onOpenChange={onOpenChange}
        state={state}
        onRetry={onRetry}
        actions={actions}
      />,
      locale,
    ),
  );
  return { ...utils, onOpenChange, onRetry };
}

const success = (overrides: Partial<AdminUserDetail> = {}): AdminUserDetailState => ({
  status: 'success',
  user: makeDetail(overrides),
});

describe('AdminUserDetailSheet — các trạng thái', () => {
  it('đang tải: skeleton ẩn khỏi trình đọc màn hình, vùng bọc aria-busy + dòng chữ sr-only, vẫn có tên hộp thoại', () => {
    const { container } = setup({ status: 'pending' });

    expect(screen.getByRole('dialog', { name: 'Chi tiết người dùng' })).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Đang tải...')).toHaveClass('sr-only');
    expect(screen.queryByRole('heading', { name: 'Nguyễn Văn An' })).not.toBeInTheDocument();
  });

  it('lỗi: báo lỗi và cho thử lại', async () => {
    const user = userEvent.setup();
    const { onRetry } = setup({ status: 'error' });

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được chi tiết');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('không tìm thấy: nói rõ, KHÔNG mời thử lại (kết quả chắc chắn), chỉ có nút Đóng', () => {
    setup({ status: 'not-found' });

    expect(screen.getByRole('status')).toHaveTextContent('Không tìm thấy người dùng');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Đóng' }).length).toBeGreaterThan(0);
  });
});

describe('AdminUserDetailSheet — dữ liệu', () => {
  it('đầu ngăn: tên là tiêu đề của hộp thoại, email, trạng thái', () => {
    setup(success());

    expect(screen.getByRole('dialog', { name: 'Nguyễn Văn An' })).toBeInTheDocument();
    expect(screen.getByText('an.nguyen@example.com', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Hoạt động')).toBeInTheDocument();
  });

  it('mục Tài khoản: ngày tham gia, email, xác thực, ngôn ngữ email, số đơn', () => {
    setup(success({ locale: 'en', orderCount: 12, isEmailVerified: false }));

    const account = within(screen.getByRole('region', { name: 'Tài khoản' }));
    expect(account.getByText('Chưa xác thực')).toBeInTheDocument();
    expect(account.getByText('Tiếng Anh')).toBeInTheDocument();
    expect(account.getByText('12')).toBeInTheDocument();
    expect(account.getByText(/2026/)).toBeInTheDocument();
  });

  it('SỐ SHOP hiện khi dữ liệu đã tải (kể cả 0), kèm tên, slug và trạng thái từng shop', () => {
    const { unmount } = setup(success({ shops: [] }));
    const none = within(screen.getByRole('region', { name: 'Shop sở hữu' }));
    expect(none.getByText('0 shop')).toBeInTheDocument();
    expect(none.getByText('Chưa có shop nào.')).toBeInTheDocument();
    unmount();

    setup(
      success({
        shops: [
          { id: 's-1', name: 'Thời Trang Thảo', slug: 'thoi-trang-thao', status: 'SUSPENDED' },
          { id: 's-2', name: 'Phụ kiện An', slug: 'phu-kien-an', status: 'APPROVED' },
        ],
      }),
    );
    const shops = within(screen.getByRole('region', { name: 'Shop sở hữu' }));
    expect(shops.getByText('2 shop')).toBeInTheDocument();
    expect(shops.getByText('Thời Trang Thảo')).toBeInTheDocument();
    expect(shops.getByText('/thoi-trang-thao')).toBeInTheDocument();
    expect(shops.getByText('Đã khoá')).toBeInTheDocument();
    expect(shops.getByText('Đã duyệt')).toBeInTheDocument();
  });

  it('có shop đang tạm ngừng -> link tới trang Shop đã lọc "Đã khoá" để mở riêng; không có thì không có link', () => {
    const { unmount } = setup(
      success({
        shops: [{ id: 's-1', name: 'A', slug: 'a', status: 'SUSPENDED' }],
      }),
    );
    expect(screen.getByRole('link', { name: 'Xem các shop đang tạm ngừng' })).toHaveAttribute(
      'href',
      '/admin/shops?status=SUSPENDED',
    );
    unmount();

    setup(success({ shops: [{ id: 's-1', name: 'A', slug: 'a', status: 'APPROVED' }] }));
    expect(
      screen.queryByRole('link', { name: 'Xem các shop đang tạm ngừng' }),
    ).not.toBeInTheDocument();
  });

  it('tài khoản bị cấm: khung trạng thái hiện tại có mốc và lý do', () => {
    setup(
      success({
        accountStatus: 'BANNED',
        statusReason: 'Lừa đảo\nnhiều lần',
        statusChangedAt: '2026-10-26T10:00:00.000Z',
      }),
    );

    const current = within(screen.getByRole('region', { name: 'Trạng thái hiện tại' }));
    expect(current.getByText(/Bị cấm từ .*2026/)).toBeInTheDocument();
    expect(current.getByText(/Lừa đảo/)).toHaveClass('whitespace-pre-line');
  });

  it('tài khoản hoạt động: không có khung trạng thái hiện tại', () => {
    setup(success());

    expect(screen.queryByRole('region', { name: 'Trạng thái hiện tại' })).not.toBeInTheDocument();
  });

  it('lịch sử quản trị: nhãn, người thao tác, thời điểm, lý do và hệ quả với shop; Admin đã bị xoá có nhãn riêng', () => {
    setup(
      success({
        history: [
          {
            id: 'h-1',
            action: 'SUSPEND_USER',
            actorId: 'a-1',
            actorName: 'Lê Quản Trị',
            reason: 'Bán hàng nhái',
            meta: { from: 'ACTIVE', to: 'SUSPENDED', shopsSuspended: 1 },
            createdAt: '2026-10-25T10:00:00.000Z',
          },
          {
            id: 'h-2',
            action: 'REACTIVATE_USER',
            actorId: 'a-2',
            actorName: null,
            reason: 'Khiếu nại được chấp nhận',
            meta: { from: 'BANNED', to: 'ACTIVE', shopsStillSuspended: 2 },
            createdAt: '2026-10-20T10:00:00.000Z',
          },
        ],
      }),
    );

    const history = within(screen.getByRole('region', { name: 'Lịch sử quản trị' }));
    const items = history.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(/Tạm khoá/)).toBeInTheDocument();
    expect(within(items[0]).getByText(/Lê Quản Trị/)).toBeInTheDocument();
    expect(within(items[0]).getByText('Bán hàng nhái')).toBeInTheDocument();
    expect(within(items[0]).getByText('1 shop bị tạm ngừng')).toBeInTheDocument();
    expect(within(items[1]).getByText(/Gỡ cấm/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/Quản trị viên đã bị xoá/)).toBeInTheDocument();
    expect(within(items[1]).getByText('2 shop vẫn tạm ngừng, cần mở riêng')).toBeInTheDocument();
  });

  it('chưa có lịch sử -> câu rỗng, không phải danh sách trống', () => {
    setup(success({ history: [] }));

    const history = within(screen.getByRole('region', { name: 'Lịch sử quản trị' }));
    expect(history.getByText('Chưa có thao tác quản trị nào.')).toBeInTheDocument();
    expect(history.queryByRole('list')).not.toBeInTheDocument();
  });

  it('chân ngăn hiện các hành động Container truyền vào; không có hành động (Admin, đã tự xoá) thì chân ngăn tự ẩn', () => {
    const { unmount } = setup(success(), {
      actions: <button type="button">Khoá</button>,
    });
    expect(screen.getByRole('button', { name: 'Khoá' })).toBeInTheDocument();
    unmount();

    setup(success({ role: 'ADMIN' }), { actions: null });
    const footer = screen.getByRole('dialog').querySelector('.border-t');
    expect(footer).toBeEmptyDOMElement();
    expect(footer).toHaveClass('empty:hidden');
  });

  it('chuỗi dài không dấu cách và HTML do người dùng nhập: hiện dạng text và bẻ dòng, không làm ngăn rộng ra', () => {
    const longName = 'N'.repeat(300);
    setup(
      success({
        name: longName,
        email: `${'e'.repeat(250)}@example.com`,
        accountStatus: 'SUSPENDED',
        statusChangedAt: '2026-10-25T10:00:00.000Z',
        statusReason: '<img src=x onerror=alert(1)> ' + 'z'.repeat(500),
      }),
    );

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { name: longName })).toHaveClass('[overflow-wrap:anywhere]');
    expect(screen.getByText(/<img src=x/)).toHaveClass('[overflow-wrap:anywhere]');
  });

  it('bản tiếng Anh: không lộ chuỗi tiếng Việt', () => {
    setup(
      success({
        accountStatus: 'BANNED',
        statusChangedAt: '2026-10-26T10:00:00.000Z',
        statusReason: 'Fraud',
        history: [
          {
            id: 'h-1',
            action: 'SUSPEND_USER',
            actorId: 'a-1',
            actorName: 'Admin A',
            reason: 'Fraud',
            meta: { from: 'ACTIVE', to: 'BANNED', shopsSuspended: 2 },
            createdAt: '2026-10-26T10:00:00.000Z',
          },
        ],
      }),
      { locale: 'en' },
    );

    expect(screen.getByRole('region', { name: 'Admin history' })).toBeInTheDocument();
    expect(screen.getByText('2 shops paused')).toBeInTheDocument();
    expect(screen.queryByText(/tài khoản|Lịch sử|Tham gia|shop bị/i)).not.toBeInTheDocument();
  });
});
