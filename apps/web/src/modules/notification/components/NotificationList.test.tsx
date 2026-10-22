import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { at, makeNotification, uuid } from '../notification-test-data';
import type { Notification } from '../types';
import { NotificationList } from './NotificationList';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, onClick, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

const NOW = Date.parse('2030-01-02T12:00:00.000Z');

function setup(
  props: Partial<{
    items: Notification[];
    filter: 'all' | 'unread';
    isPending: boolean;
    isError: boolean;
    hasMore: boolean;
    isFetchingMore: boolean;
    isFetchMoreError: boolean;
  }> = {},
) {
  const handlers = { onOpen: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn() };
  const utils = render(
    withIntl(
      <NotificationList
        items={props.items ?? []}
        filter={props.filter ?? 'all'}
        now={NOW}
        isPending={props.isPending ?? false}
        isError={props.isError ?? false}
        hasMore={props.hasMore ?? false}
        isFetchingMore={props.isFetchingMore ?? false}
        isFetchMoreError={props.isFetchMoreError ?? false}
        {...handlers}
      />,
    ),
  );
  return { ...utils, ...handlers };
}

const two = [
  makeNotification({ id: uuid(2), createdAt: at(10) }),
  makeNotification({ id: uuid(1), createdAt: at(0), readAt: at(1) }),
];

describe('NotificationList', () => {
  it('đang tải: skeleton aria-hidden + vùng aria-busy + dòng sr-only đã dịch, chưa có nút nào', () => {
    const { container } = setup({ isPending: true });

    expect(screen.getByText('Đang tải thông báo...')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('ul[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lỗi khi chưa có dữ liệu: thông điệp ĐÃ DỊCH (không lộ lỗi thô) + nút Thử lại gọi onRetry', async () => {
    const { onRetry } = setup({ isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không tải được thông báo. Vui lòng thử lại.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lỗi nhưng ĐÃ có dữ liệu cũ ⇒ vẫn hiện danh sách (không thay bằng màn hình lỗi)', () => {
    setup({ isError: true, items: two });

    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(
      screen.queryByText('Không tải được thông báo. Vui lòng thử lại.'),
    ).not.toBeInTheDocument();
  });

  it('trống ở tab "Tất cả": lời gợi ý chung', () => {
    setup({ filter: 'all' });

    expect(screen.getByText('Chưa có thông báo nào')).toBeInTheDocument();
    expect(screen.queryByText('Bạn đã đọc hết thông báo')).not.toBeInTheDocument();
  });

  it('trống ở tab "Chưa đọc": lời "đã đọc hết", khác với "chưa có"', () => {
    setup({ filter: 'unread' });

    expect(screen.getByText('Bạn đã đọc hết thông báo')).toBeInTheDocument();
    expect(screen.queryByText('Chưa có thông báo nào')).not.toBeInTheDocument();
  });

  it('có dữ liệu: danh sách có nhãn trợ năng, đúng thứ tự truyền vào, mỗi dòng một link', () => {
    setup({ items: two });

    const list = screen.getByRole('list', { name: 'Danh sách thông báo' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('bấm một dòng ⇒ onOpen nhận đúng thông báo của dòng đó', async () => {
    const { onOpen } = setup({ items: two });

    await userEvent.click(screen.getAllByRole('link')[0]);

    expect(onOpen).toHaveBeenCalledWith(two[0]);
  });

  it('còn trang sau ⇒ nút "Tải thêm" gọi onLoadMore; hết trang ⇒ không có nút', async () => {
    const { onLoadMore, rerender } = setup({ items: two, hasMore: true });

    await userEvent.click(screen.getByRole('button', { name: 'Tải thêm' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      withIntl(
        <NotificationList
          items={two}
          filter="all"
          now={NOW}
          isPending={false}
          isError={false}
          hasMore={false}
          isFetchingMore={false}
          isFetchMoreError={false}
          onOpen={vi.fn()}
          onLoadMore={vi.fn()}
          onRetry={vi.fn()}
        />,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Tải thêm' })).not.toBeInTheDocument();
  });

  it('đang tải thêm ⇒ nút vô hiệu và đổi chữ (chặn bấm đúp)', () => {
    setup({ items: two, hasMore: true, isFetchingMore: true });

    const button = screen.getByRole('button', { name: 'Đang tải...' });
    expect(button).toBeDisabled();
  });

  it('tải thêm lỗi ⇒ danh sách giữ nguyên + lời nhắc có role=alert, nút vẫn bấm lại được', () => {
    setup({ items: two, hasMore: true, isFetchMoreError: true });

    expect(screen.getByRole('alert')).toHaveTextContent('Không tải thêm được. Vui lòng thử lại.');
    expect(screen.getByRole('button', { name: 'Tải thêm' })).toBeEnabled();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
