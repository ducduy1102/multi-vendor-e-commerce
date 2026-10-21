import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { at, CONVERSATION_ID, makeMessage, uuid } from '../chat-test-data';
import type { ChatMessageView } from '../hooks/chat-messages';
import type { ChatSendFailure } from '../types';
import { MessageBubble } from './MessageBubble';

function setup(
  message: Partial<ChatMessageView> = {},
  props: { isOwn?: boolean; showTime?: boolean; isSeen?: boolean } = {},
) {
  const onRetry = vi.fn();
  const onDiscard = vi.fn();
  const describeFailure = vi.fn((failure: ChatSendFailure) => `lỗi ${failure.status}`);
  const utils = render(
    withIntl(
      <MessageBubble
        message={makeMessage(message)}
        isOwn={props.isOwn ?? true}
        counterpartName="Shop Áo"
        showTime={props.showTime ?? false}
        isSeen={props.isSeen ?? false}
        describeFailure={describeFailure}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />,
    ),
  );
  return { ...utils, onRetry, onDiscard, describeFailure };
}

describe('MessageBubble', () => {
  it('nội dung là CHỮ THUẦN: <img onerror>/<script> hiện đúng như chữ, không dựng phần tử nào', () => {
    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const { container } = setup({ content: payload });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(payload, { exact: false })).toBeInTheDocument();
  });

  it('không tự biến URL thành link', () => {
    const { container } = setup({ content: 'xem https://example.com/a nhé' });

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText(/https:\/\/example\.com\/a/)).toBeInTheDocument();
  });

  it('xuống dòng được giữ (whitespace-pre-wrap) và chuỗi dài bẻ được (overflow-wrap:anywhere)', () => {
    setup({ content: 'dòng 1\ndòng 2' });

    const bubble = screen.getByText(/dòng 1/);
    expect(bubble.className).toContain('whitespace-pre-wrap');
    expect(bubble.className).toContain('[overflow-wrap:anywhere]');
    expect(bubble.className).toContain('min-w-0');
  });

  it('căn theo người gửi và có nhãn người gửi cho trình đọc màn hình', () => {
    const own = setup({ content: 'của mình' }, { isOwn: true });
    expect(screen.getByText('Bạn:', { exact: false })).toHaveClass('sr-only');
    expect(own.container.firstElementChild).toHaveClass('items-end');
    own.unmount();

    const theirs = setup({ content: 'của shop', senderRole: 'SHOP' }, { isOwn: false });
    expect(screen.getByText('Shop Áo:', { exact: false })).toHaveClass('sr-only');
    expect(theirs.container.firstElementChild).toHaveClass('items-start');
  });

  it('giờ gửi hiện ở tin cuối nhóm (đúng thẻ <time> với ISO), "Đã xem" kèm theo khi đối phương đã đọc', () => {
    setup({ createdAt: at(0) }, { showTime: true, isSeen: true });

    const time = document.querySelector('time');
    expect(time).toHaveAttribute('datetime', at(0));
    expect(screen.getByText('Đã xem')).toBeInTheDocument();
  });

  it('không có giờ/đã xem thì không dựng dòng chân', () => {
    const { container } = setup({}, { showTime: false, isSeen: false });

    expect(container.querySelector('time')).toBeNull();
    expect(screen.queryByText('Đã xem')).not.toBeInTheDocument();
  });

  it('đang gửi: hiện "Đang gửi...", không giờ/đã xem, không nút', () => {
    setup(
      { id: `pending:${uuid(50)}`, clientMessageId: uuid(50), deliveryStatus: 'sending' },
      { showTime: true, isSeen: true },
    );

    expect(screen.getByText('Đang gửi...')).toBeInTheDocument();
    expect(screen.queryByText('Đã xem')).not.toBeInTheDocument();
    expect(document.querySelector('time')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('gửi lỗi có thể thử lại (mất mạng): lý do + "Thử lại" gửi ĐÚNG clientMessageId + "Xoá"', async () => {
    const user = userEvent.setup();
    const { onRetry, onDiscard, describeFailure } = setup({
      id: `pending:${uuid(50)}`,
      conversationId: CONVERSATION_ID,
      clientMessageId: uuid(50),
      deliveryStatus: 'failed',
      failure: { status: 0 },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Gửi lỗi — lỗi 0');
    expect(describeFailure).toHaveBeenCalledWith({ status: 0 });

    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledWith(uuid(50));
    await user.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(onDiscard).toHaveBeenCalledWith(uuid(50));
  });

  it.each([
    [429, true],
    [500, true],
    [409, false],
    [404, false],
    [400, false],
  ])('lỗi %i: nút "Thử lại" %s, "Xoá" luôn có', (status, canRetry) => {
    setup({
      id: `pending:${uuid(50)}`,
      clientMessageId: uuid(50),
      deliveryStatus: 'failed',
      failure: { status },
    });

    expect(screen.queryByRole('button', { name: 'Thử lại' }) !== null).toBe(canRetry);
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeInTheDocument();
  });

  it('tin đã gửi không bao giờ có nút thử lại/xoá', () => {
    setup({ clientMessageId: uuid(50) }, { showTime: true });

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
