import { beforeEach, describe, expect, it } from 'vitest';

import { CONVERSATION_ID, OTHER_CONVERSATION_ID, at, uuid } from '../chat-test-data';
import { EMPTY_OUTBOX, resetChatOutbox, useChatOutboxStore } from './chat-outbox.store';

const base = (n: number, conversationId = CONVERSATION_ID) => ({
  clientMessageId: uuid(n),
  conversationId,
  senderRole: 'BUYER' as const,
  content: `tin ${n}`,
  createdAt: at(n),
});
const itemsOf = (conversationId = CONVERSATION_ID) =>
  useChatOutboxStore.getState().byConversation[conversationId];

describe('useChatOutboxStore', () => {
  beforeEach(() => resetChatOutbox());

  it('enqueue: tin mới ở trạng thái "đang gửi", MỚI NHẤT trước', () => {
    const { enqueue } = useChatOutboxStore.getState();

    enqueue(base(1));
    enqueue(base(2));

    expect(itemsOf()?.map((i) => i.clientMessageId)).toEqual([uuid(2), uuid(1)]);
    expect(itemsOf()?.every((i) => i.deliveryStatus === 'sending')).toBe(true);
  });

  it('enqueue cùng clientMessageId hai lần không nhân đôi', () => {
    const { enqueue } = useChatOutboxStore.getState();

    enqueue(base(1));
    enqueue(base(1));

    expect(itemsOf()).toHaveLength(1);
  });

  it('markFailed: giữ nguyên nội dung + khoá, thêm lý do lỗi', () => {
    const { enqueue, markFailed } = useChatOutboxStore.getState();
    enqueue(base(1));

    markFailed(CONVERSATION_ID, uuid(1), { status: 429, code: 'CHAT_RATE_LIMITED' });

    expect(itemsOf()?.[0]).toMatchObject({
      clientMessageId: uuid(1),
      content: 'tin 1',
      deliveryStatus: 'failed',
      failure: { status: 429, code: 'CHAT_RATE_LIMITED' },
    });
  });

  it('markSending (thử lại): về "đang gửi" và XOÁ lý do lỗi cũ, vẫn đúng clientMessageId', () => {
    const { enqueue, markFailed, markSending } = useChatOutboxStore.getState();
    enqueue(base(1));
    markFailed(CONVERSATION_ID, uuid(1), { status: 0 });

    markSending(CONVERSATION_ID, uuid(1));

    const item = itemsOf()?.[0];
    expect(item?.deliveryStatus).toBe('sending');
    expect(item).not.toHaveProperty('failure');
    expect(item?.clientMessageId).toBe(uuid(1));
  });

  it('markFailed/markSending/remove với id không có ⇒ không đổi gì (cùng object state)', () => {
    const { enqueue, markFailed, markSending, remove } = useChatOutboxStore.getState();
    enqueue(base(1));
    const before = useChatOutboxStore.getState().byConversation;

    markFailed(CONVERSATION_ID, uuid(99), { status: 0 });
    markSending(OTHER_CONVERSATION_ID, uuid(1));
    remove(CONVERSATION_ID, uuid(99));

    expect(useChatOutboxStore.getState().byConversation).toBe(before);
  });

  it('remove: gỡ đúng một tin; hội thoại hết tin thì bỏ luôn khoá (không để mảng rỗng)', () => {
    const { enqueue, remove } = useChatOutboxStore.getState();
    enqueue(base(1));
    enqueue(base(2));

    remove(CONVERSATION_ID, uuid(1));
    expect(itemsOf()?.map((i) => i.clientMessageId)).toEqual([uuid(2)]);

    remove(CONVERSATION_ID, uuid(2));
    expect(useChatOutboxStore.getState().byConversation).toEqual({});
  });

  it('các hội thoại độc lập nhau', () => {
    const { enqueue, markFailed, remove } = useChatOutboxStore.getState();
    enqueue(base(1));
    enqueue(base(1, OTHER_CONVERSATION_ID));

    markFailed(CONVERSATION_ID, uuid(1), { status: 500 });
    expect(itemsOf(OTHER_CONVERSATION_ID)?.[0].deliveryStatus).toBe('sending');

    remove(CONVERSATION_ID, uuid(1));
    expect(itemsOf(OTHER_CONVERSATION_ID)).toHaveLength(1);
  });

  it('resetChatOutbox xoá sạch mọi hội thoại (đăng xuất / đổi tài khoản)', () => {
    const { enqueue } = useChatOutboxStore.getState();
    enqueue(base(1));
    enqueue(base(1, OTHER_CONVERSATION_ID));

    resetChatOutbox();

    expect(useChatOutboxStore.getState().byConversation).toEqual({});
  });

  it('EMPTY_OUTBOX là một mảng bất biến dùng chung (selector không sinh mảng mới mỗi lần)', () => {
    expect(EMPTY_OUTBOX).toHaveLength(0);
    expect(Object.isFrozen(EMPTY_OUTBOX)).toBe(true);
  });
});
