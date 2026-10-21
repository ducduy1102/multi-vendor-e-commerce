import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeSummary } from '../chat-test-data';
import type { ChatRole, ConversationSummary } from '../types';
import { ConversationListItem } from './ConversationListItem';

const NOW = new Date(2030, 0, 10, 15, 0, 0).getTime();
const local = (day: number, hour: number, minute = 0) =>
  new Date(2030, 0, day, hour, minute, 0).toISOString();

function setup(
  overrides: Partial<ConversationSummary> = {},
  props: { viewerRole?: ChatRole; isSelected?: boolean; locale?: 'vi' | 'en' } = {},
) {
  const onSelect = vi.fn();
  const summary = makeSummary(overrides);
  render(
    withIntl(
      <ConversationListItem
        conversation={summary}
        viewerRole={props.viewerRole ?? 'BUYER'}
        isSelected={props.isSelected ?? false}
        now={NOW}
        onSelect={onSelect}
      />,
      props.locale,
    ),
  );
  return { onSelect, summary };
}

describe('ConversationListItem', () => {
  it('hiện tên đối phương, tin cuối và thời gian tương đối', () => {
    setup({
      counterpart: { name: 'Shop Áo Xinh', logoUrl: null },
      lastMessage: { content: 'Còn hàng nhé', senderRole: 'SHOP', createdAt: local(10, 14, 30) },
      lastMessageAt: local(10, 14, 30),
    });

    expect(screen.getByText('Shop Áo Xinh')).toBeInTheDocument();
    expect(screen.getByText('Còn hàng nhé')).toBeInTheDocument();
    expect(screen.getByText('30 phút')).toBeInTheDocument();
  });

  it.each([
    [new Date(NOW - 30_000).toISOString(), 'Vừa xong'],
    [local(10, 12, 0), '3 giờ'],
    [local(9, 22, 0), 'Hôm qua'],
    // Định dạng ngày ngắn phụ thuộc dữ liệu ICU của môi trường (vi có thể là 07-01 hoặc 07/01) nên so với chính Intl.
    [
      local(7, 9, 0),
      new Intl.DateTimeFormat('vi', { day: '2-digit', month: '2-digit' }).format(
        new Date(2030, 0, 7),
      ),
    ],
  ])('nhãn thời gian cho %s là %s', (lastMessageAt, label) => {
    setup({ lastMessageAt });

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('bản tiếng Anh dùng nhãn tiếng Anh', () => {
    setup({ lastMessageAt: local(10, 12, 0) }, { locale: 'en' });

    expect(screen.getByText('3 h')).toBeInTheDocument();
  });

  it('tin cuối của CHÍNH MÌNH có tiền tố "Bạn:", của đối phương thì không', () => {
    const mine = setup({
      lastMessage: { content: 'em cần size M', senderRole: 'BUYER', createdAt: local(10, 14) },
    });
    expect(mine.summary).toBeDefined();
    expect(screen.getByText('Bạn: em cần size M')).toBeInTheDocument();
  });

  it('vai chủ shop: tin của SHOP là của mình, tin của BUYER là của đối phương', () => {
    setup(
      { lastMessage: { content: 'khách hỏi', senderRole: 'BUYER', createdAt: local(10, 14) } },
      { viewerRole: 'SHOP' },
    );

    expect(screen.getByText('khách hỏi')).toBeInTheDocument();
    expect(screen.queryByText(/^Bạn:/)).not.toBeInTheDocument();
  });

  it('hội thoại chưa có tin: hiện "Chưa có tin nhắn", không có thời gian', () => {
    setup({ lastMessage: null, lastMessageAt: null });

    expect(screen.getByText('Chưa có tin nhắn')).toBeInTheDocument();
  });

  it('có chưa đọc: huy hiệu số (aria-hidden) + bản đọc cho trình đọc màn hình + tên đậm', () => {
    setup({ unreadCount: 3 });

    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('3 tin chưa đọc')).toHaveClass('sr-only');
    expect(screen.getByText('Shop Áo')).toHaveClass('font-semibold');
  });

  it('quá 99 chưa đọc hiện "99+"', () => {
    setup({ unreadCount: 250 });

    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('hết chưa đọc: không huy hiệu, tên không đậm', () => {
    setup({ unreadCount: 0 });

    expect(screen.queryByText(/chưa đọc/)).not.toBeInTheDocument();
    expect(screen.getByText('Shop Áo')).toHaveClass('font-medium');
  });

  it('bản tiếng Anh đọc số chưa đọc đúng số ít/số nhiều', () => {
    setup({ unreadCount: 1 }, { locale: 'en' });
    expect(screen.getByText('1 unread message')).toBeInTheDocument();
  });

  it('đang chọn: aria-current="true"; không chọn thì không có thuộc tính', () => {
    const selected = render(
      withIntl(
        <ConversationListItem
          conversation={makeSummary()}
          viewerRole="BUYER"
          isSelected
          now={NOW}
          onSelect={vi.fn()}
        />,
      ),
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true');
    selected.unmount();

    setup();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current');
  });

  it('chữ phụ (tin cuối, thời gian) đậm lên khi dòng có nền bg-muted (chọn/hover/focus) để đủ tương phản 4,5:1', () => {
    setup({
      lastMessage: { content: 'Còn hàng nhé', senderRole: 'SHOP', createdAt: local(10, 14, 30) },
      lastMessageAt: local(10, 14, 30),
    });

    // jsdom không tính được Tailwind nên giữ đúng cặp lớp đã đo bằng trình duyệt thật (4,35:1 → ≥ 4,5:1).
    expect(screen.getByRole('button')).toHaveClass('group');
    for (const text of ['Còn hàng nhé', '30 phút']) {
      expect(screen.getByText(text)).toHaveClass(
        'text-muted-foreground',
        'group-hover:text-foreground/75',
        'group-focus-visible:text-foreground/75',
        'group-aria-[current=true]:text-foreground/75',
      );
    }
  });

  it('bấm gọi onSelect với id hội thoại', async () => {
    const user = userEvent.setup();
    const { onSelect, summary } = setup();

    await user.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith(summary.id);
  });

  it('tên và tin cuối rất dài bị cắt (truncate) trong cột min-w-0, không đẩy rộng dòng', () => {
    const longText = 'x'.repeat(300);
    setup({
      counterpart: { name: longText, logoUrl: null },
      lastMessage: { content: longText, senderRole: 'SHOP', createdAt: local(10, 14) },
    });

    for (const element of screen.getAllByText(longText)) {
      expect(element).toHaveClass('truncate');
    }
    expect(screen.getAllByText(longText)[0].parentElement).toHaveClass('min-w-0');
  });

  it('logo http (không an toàn) bị bỏ, rơi về chữ cái đầu; logo https hiện ảnh', () => {
    const insecure = render(
      withIntl(
        <ConversationListItem
          conversation={makeSummary({
            counterpart: { name: 'Shop Áo Xinh', logoUrl: 'http://cdn.example.org/logo.png' },
          })}
          viewerRole="BUYER"
          isSelected={false}
          now={NOW}
          onSelect={vi.fn()}
        />,
      ),
    );
    expect(insecure.container.querySelector('img')).toBeNull();
    expect(screen.getByText('SX')).toBeInTheDocument();
    insecure.unmount();

    const secure = render(
      withIntl(
        <ConversationListItem
          conversation={makeSummary({
            counterpart: { name: 'Shop Áo Xinh', logoUrl: 'https://cdn.example.org/logo.png' },
          })}
          viewerRole="BUYER"
          isSelected={false}
          now={NOW}
          onSelect={vi.fn()}
        />,
      ),
    );
    expect(secure.container.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example.org/logo.png',
    );
    expect(secure.container.querySelector('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  });
});
