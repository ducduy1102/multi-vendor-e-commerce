import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { OTHER_CONVERSATION_ID, makeSummary } from '../chat-test-data';
import type { ChatRole, ConversationSummary } from '../types';
import { ConversationList } from './ConversationList';

const NOW = new Date(2030, 0, 10, 15, 0, 0).getTime();

function setup(
  props: Partial<{
    items: ConversationSummary[];
    viewerRole: ChatRole;
    selectedId: string | null;
    isPending: boolean;
    isError: boolean;
    hasMore: boolean;
    isFetchingMore: boolean;
  }> = {},
) {
  const handlers = { onSelect: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn() };
  const utils = render(
    withIntl(
      <ConversationList
        items={props.items ?? []}
        viewerRole={props.viewerRole ?? 'BUYER'}
        selectedId={props.selectedId ?? null}
        now={NOW}
        isPending={props.isPending ?? false}
        isError={props.isError ?? false}
        hasMore={props.hasMore ?? false}
        isFetchingMore={props.isFetchingMore ?? false}
        {...handlers}
      />,
    ),
  );
  return { ...utils, ...handlers };
}

describe('ConversationList', () => {
  it('đang tải: skeleton aria-hidden + vùng aria-busy + dòng sr-only đã dịch', () => {
    const { container } = setup({ isPending: true });

    expect(screen.getByText('Đang tải danh sách cuộc trò chuyện...')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('ul[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lỗi tải (chưa có gì): câu đã dịch + nút "Thử lại" gọi onRetry; không lộ error.message', async () => {
    const user = userEvent.setup();
    const { onRetry } = setup({ isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không tải được danh sách cuộc trò chuyện.',
    );
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lỗi khi đã có dữ liệu (tải lại thất bại): vẫn hiện danh sách cũ, không thay bằng màn lỗi', () => {
    setup({ isError: true, items: [makeSummary()] });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Shop Áo')).toBeInTheDocument();
  });

  it('trống: "Chưa có cuộc trò chuyện" với lời gợi ý riêng cho người mua và chủ shop', () => {
    const buyer = setup({ viewerRole: 'BUYER' });
    expect(screen.getByText('Chưa có cuộc trò chuyện')).toBeInTheDocument();
    expect(screen.getByText(/Chat với shop/)).toBeInTheDocument();
    buyer.unmount();

    setup({ viewerRole: 'SHOP' });
    expect(screen.getByText('Chưa có cuộc trò chuyện')).toBeInTheDocument();
    expect(screen.getByText(/khách hàng nhắn tin cho shop của bạn/)).toBeInTheDocument();
  });

  it('có dữ liệu: mỗi hội thoại một dòng, dòng đang chọn có aria-current, bấm gọi onSelect', async () => {
    const user = userEvent.setup();
    const first = makeSummary({ counterpart: { name: 'Shop A', logoUrl: null } });
    const second = makeSummary({
      id: OTHER_CONVERSATION_ID,
      counterpart: { name: 'Shop B', logoUrl: null },
    });
    const { onSelect } = setup({ items: [first, second], selectedId: second.id });

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Shop B/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /Shop A/ })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: /Shop A/ }));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });

  it('còn trang sau: nút "Xem thêm cuộc trò chuyện"; đang tải thì tắt; hết thì không có nút', async () => {
    const user = userEvent.setup();
    const more = setup({ items: [makeSummary()], hasMore: true });
    await user.click(screen.getByRole('button', { name: 'Xem thêm cuộc trò chuyện' }));
    expect(more.onLoadMore).toHaveBeenCalledTimes(1);
    more.unmount();

    const fetching = setup({ items: [makeSummary()], hasMore: true, isFetchingMore: true });
    expect(screen.getByRole('button', { name: 'Đang tải...' })).toBeDisabled();
    fetching.unmount();

    setup({ items: [makeSummary()], hasMore: false });
    expect(screen.queryByRole('button', { name: /Xem thêm/ })).not.toBeInTheDocument();
  });
});
