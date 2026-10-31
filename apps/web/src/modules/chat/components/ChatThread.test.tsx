import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { withIntl } from '@/shared/lib/test-i18n';

import { makeMessage, uuid } from '../chat-test-data';
import type { ChatMessageView } from '../hooks/chat-messages';
import type { ChatRole } from '../types';
import { ChatThread } from './ChatThread';

const NOW = new Date(2030, 0, 10, 15, 0, 0).getTime();

interface Props {
  viewerRole: ChatRole;
  isReadOnly: boolean;
  items: ChatMessageView[];
  isPending: boolean;
  loadErrorMessage: string | null;
  isCounterpartTyping: boolean;
  isConnectionLost: boolean;
  hasOlder: boolean;
  reportSlot: ReactNode;
}

function setup(props: Partial<Props> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onFetchOlder: vi.fn(),
    onReload: vi.fn(),
    onSend: vi.fn(),
    onTyping: vi.fn(),
    onRetrySend: vi.fn(),
    onDiscard: vi.fn(),
  };
  const utils = render(
    withIntl(
      <ChatThread
        counterpartName="Shop Áo Xinh"
        counterpartLogoUrl={null}
        viewerRole={props.viewerRole ?? 'BUYER'}
        isReadOnly={props.isReadOnly ?? false}
        items={props.items ?? []}
        isPending={props.isPending ?? false}
        loadErrorMessage={props.loadErrorMessage ?? null}
        hasOlder={props.hasOlder ?? false}
        isFetchingOlder={false}
        otherLastReadAt={null}
        isCounterpartTyping={props.isCounterpartTyping ?? false}
        isConnectionLost={props.isConnectionLost ?? false}
        now={NOW}
        reportSlot={props.reportSlot}
        describeFailure={() => 'lỗi'}
        {...handlers}
      />,
    ),
  );
  return { ...utils, ...handlers };
}

const message = (overrides: Partial<ChatMessageView> = {}) =>
  makeMessage({
    id: uuid(1),
    content: 'xin chào',
    createdAt: new Date(2030, 0, 10, 9, 0, 0).toISOString(),
    ...overrides,
  });

describe('ChatThread', () => {
  it('tiêu đề có tên đối phương; nút quay lại gọi onBack', async () => {
    const user = userEvent.setup();
    const { onBack } = setup();

    expect(screen.getByRole('heading', { name: 'Shop Áo Xinh' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quay lại danh sách' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('đang tải: skeleton aria-hidden trong vùng aria-busy kèm dòng sr-only; ô nhập vẫn dựng sẵn', () => {
    const { container } = setup({ isPending: true });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Đang tải tin nhắn...')).toHaveClass('sr-only');
    expect(container.querySelector('[aria-hidden="true"].grid')).not.toBeNull();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('lỗi tải mà chưa có tin: câu lỗi đã dịch + "Thử lại" gọi onReload', async () => {
    const user = userEvent.setup();
    const { onReload } = setup({ loadErrorMessage: 'Bạn không có quyền xem cuộc trò chuyện này' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bạn không có quyền xem cuộc trò chuyện này',
    );
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('lỗi tải mà ĐÃ có tin: vẫn hiện tin cũ, không thay bằng màn lỗi', () => {
    setup({ loadErrorMessage: 'lỗi', items: [message()] });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('xin chào', { exact: false })).toBeInTheDocument();
  });

  it('hội thoại trống: lời mở đầu khác nhau cho người mua và chủ shop', () => {
    const buyer = setup({ viewerRole: 'BUYER' });
    expect(screen.getByText('Hãy gửi lời chào đầu tiên tới shop.')).toBeInTheDocument();
    buyer.unmount();

    setup({ viewerRole: 'SHOP' });
    expect(screen.getByText('Chưa có tin nhắn nào trong cuộc trò chuyện này.')).toBeInTheDocument();
  });

  it('gửi từ ô nhập gọi onSend; thử lại/xoá tin lỗi chuyển đúng clientMessageId', async () => {
    const user = userEvent.setup();
    const failed = message({
      id: `pending:${uuid(50)}`,
      senderRole: 'BUYER',
      clientMessageId: uuid(50),
      deliveryStatus: 'failed',
      failure: { status: 0 },
    });
    const { onSend, onRetrySend, onDiscard } = setup({ items: [failed] });

    await user.type(screen.getByRole('textbox'), 'chào{Enter}');
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith('chào'));

    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetrySend).toHaveBeenCalledWith(uuid(50));
    await user.click(screen.getByRole('button', { name: 'Xoá' }));
    expect(onDiscard).toHaveBeenCalledWith(uuid(50));
  });

  it('chỉ đọc: ô nhập tắt kèm lý do bằng chữ (khác nhau theo vai) và nhãn "Chỉ đọc" ở tiêu đề', () => {
    const buyer = setup({ isReadOnly: true, viewerRole: 'BUYER' });
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByText(/Shop hiện không nhận tin nhắn mới/)).toBeInTheDocument();
    expect(screen.getByText('Chỉ đọc')).toBeInTheDocument();
    buyer.unmount();

    setup({ isReadOnly: true, viewerRole: 'SHOP' });
    expect(screen.getByText(/Shop của bạn hiện không hoạt động/)).toBeInTheDocument();
  });

  it('không chỉ đọc: ô nhập dùng được, không có nhãn "Chỉ đọc"', () => {
    setup({ isReadOnly: false });

    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.queryByText('Chỉ đọc')).not.toBeInTheDocument();
  });

  it('mất kết nối: có dòng báo nhưng ô nhập VẪN dùng được (tin vào hộp chờ, gửi lỗi thì thử lại)', () => {
    setup({ isConnectionLost: true });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Mất kết nối, tin nhắn mới có thể đến chậm.',
    );
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('còn kết nối: không có dòng báo mất kết nối', () => {
    setup({ isConnectionLost: false });

    expect(screen.queryByText(/Mất kết nối/)).not.toBeInTheDocument();
  });

  it('đối phương đang gõ: hiện tên; dòng này luôn chiếm chỗ (min-h-5) để khung không nhảy', () => {
    const typing = setup({ isCounterpartTyping: true });
    const line = screen.getByText('Shop Áo Xinh đang nhập...');
    expect(line).toHaveClass('min-h-5');
    typing.unmount();

    const { container } = setup({ isCounterpartTyping: false });
    expect(screen.queryByText(/đang nhập/)).not.toBeInTheDocument();
    expect(container.querySelector('p.min-h-5')).not.toBeNull();
  });

  it('nút báo cáo (reportSlot) chỉ hiện khi hội thoại ĐÃ có tin — hội thoại rỗng không báo được (BE trả 404)', () => {
    const report = <button type="button">Báo cáo hội thoại</button>;

    const empty = setup({ items: [], reportSlot: report });
    expect(screen.queryByRole('button', { name: 'Báo cáo hội thoại' })).toBeNull();
    empty.unmount();

    setup({ items: [message()], reportSlot: report });
    expect(screen.getByRole('button', { name: 'Báo cáo hội thoại' })).toBeInTheDocument();
  });

  it('còn tin cũ: hiện nút "Tải tin cũ hơn" và gọi onFetchOlder', async () => {
    const user = userEvent.setup();
    const { onFetchOlder } = setup({ items: [message()], hasOlder: true });

    await user.click(screen.getByRole('button', { name: 'Tải tin cũ hơn' }));

    expect(onFetchOlder).toHaveBeenCalledTimes(1);
  });
});
