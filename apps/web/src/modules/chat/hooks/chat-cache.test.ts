import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
  at,
  conversationsData,
  makeMessage,
  makeSummary,
  messagesData,
  uuid,
} from '../chat-test-data';
import type { ChatScope, UnreadCount } from '../types';
import {
  adjustUnreadCount,
  bumpConversationWithMessage,
  clearConversationUnread,
  compareNewestFirst,
  findConversation,
  setOtherReadMark,
  upsertServerMessage,
  type ConversationsData,
  type MessagesData,
} from './chat-cache';
import {
  conversationsQueryKey,
  messagesQueryKey,
  otherReadMarkQueryKey,
  unreadCountQueryKey,
} from './chat-query-keys';

const BUYER: ChatScope = { role: 'BUYER' };
const SHOP: ChatScope = { role: 'SHOP', shopId: uuid(2001) };

let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient();
});

const itemsOf = (scope: ChatScope, id = CONVERSATION_ID) =>
  queryClient
    .getQueryData<MessagesData>(messagesQueryKey(scope, id))
    ?.pages.map((p) => p.items.map((m) => m.id));
const listOf = () =>
  queryClient
    .getQueryData<ConversationsData>(conversationsQueryKey(BUYER))
    ?.pages.map((p) => p.items.map((c) => c.id));

describe('compareNewestFirst', () => {
  it('mới hơn trước; cùng thời điểm thì id lớn hơn trước (khớp ORDER BY created_at DESC, id DESC của BE)', () => {
    const older = { id: uuid(1), createdAt: at(0) };
    const newer = { id: uuid(1), createdAt: at(1) };
    const bigId = { id: uuid(9), createdAt: at(0) };

    expect([older, newer].sort(compareNewestFirst)).toEqual([newer, older]);
    expect([older, bigId].sort(compareNewestFirst)).toEqual([bigId, older]);
    expect(compareNewestFirst(older, { ...older })).toBe(0);
  });
});

describe('upsertServerMessage', () => {
  it('hội thoại CHƯA nạp tin nào ⇒ không làm gì và KHÔNG tạo cache giả (hook vẫn nạp lần đầu đầy đủ)', () => {
    const result = upsertServerMessage(queryClient, BUYER, makeMessage());

    expect(result).toBe(false);
    expect(queryClient.getQueryData(messagesQueryKey(BUYER, CONVERSATION_ID))).toBeUndefined();
    expect(queryClient.getQueryState(messagesQueryKey(BUYER, CONVERSATION_ID))).toBeUndefined();
  });

  it('tin mới nhất chèn vào ĐẦU trang đầu', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData([makeMessage({ id: uuid(1), createdAt: at(1) })]),
    );

    upsertServerMessage(queryClient, BUYER, makeMessage({ id: uuid(2), createdAt: at(2) }));

    expect(itemsOf(BUYER)).toEqual([[uuid(2), uuid(1)]]);
  });

  it('tin tới lệch thứ tự được chèn đúng chỗ theo thời gian, không nhất thiết ở đầu', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData([
        makeMessage({ id: uuid(3), createdAt: at(3) }),
        makeMessage({ id: uuid(1), createdAt: at(1) }),
      ]),
    );

    upsertServerMessage(queryClient, BUYER, makeMessage({ id: uuid(2), createdAt: at(2) }));

    expect(itemsOf(BUYER)).toEqual([[uuid(3), uuid(2), uuid(1)]]);
  });

  it('hai tin CÙNG mili-giây: id lớn hơn đứng trước', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData([makeMessage({ id: uuid(5), createdAt: at(1) })]),
    );

    upsertServerMessage(queryClient, BUYER, makeMessage({ id: uuid(9), createdAt: at(1) }));
    upsertServerMessage(queryClient, BUYER, makeMessage({ id: uuid(2), createdAt: at(1) }));

    expect(itemsOf(BUYER)).toEqual([[uuid(9), uuid(5), uuid(2)]]);
  });

  it('khử trùng theo `id`: cùng một tin tới hai lần (real-time + phản hồi HTTP) chỉ có MỘT dòng', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData([makeMessage({ id: uuid(1), createdAt: at(1) })]),
    );
    const message = makeMessage({ id: uuid(2), createdAt: at(2) });

    upsertServerMessage(queryClient, BUYER, message);
    upsertServerMessage(queryClient, BUYER, message);

    expect(itemsOf(BUYER)).toEqual([[uuid(2), uuid(1)]]);
  });

  it('khử trùng theo `clientMessageId`: bản server thay thế dòng cùng khoá (không nhân đôi tin của chính mình)', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData([makeMessage({ id: uuid(7), clientMessageId: uuid(50), createdAt: at(1) })]),
    );

    upsertServerMessage(
      queryClient,
      BUYER,
      makeMessage({ id: uuid(8), clientMessageId: uuid(50), createdAt: at(2) }),
    );

    expect(itemsOf(BUYER)).toEqual([[uuid(8)]]);
  });

  it('tin của đối phương (không có clientMessageId) không bao giờ bị nhầm với tin khác chỉ vì cùng "không có khoá"', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData([makeMessage({ id: uuid(1), senderRole: 'SHOP', createdAt: at(1) })]),
    );

    upsertServerMessage(
      queryClient,
      BUYER,
      makeMessage({ id: uuid(2), senderRole: 'SHOP', createdAt: at(2) }),
    );

    expect(itemsOf(BUYER)).toEqual([[uuid(2), uuid(1)]]);
  });

  it('tin đã nằm ở trang SAU (cũ hơn) thì bị gỡ khỏi trang đó và chỉ còn một bản', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData(
        [makeMessage({ id: uuid(3), createdAt: at(3) })],
        [makeMessage({ id: uuid(1), createdAt: at(1) })],
      ),
    );

    upsertServerMessage(queryClient, BUYER, makeMessage({ id: uuid(1), createdAt: at(1) }));

    const ids = itemsOf(BUYER)?.flat();
    expect(ids?.filter((id) => id === uuid(1))).toHaveLength(1);
    expect(ids).toEqual([uuid(3), uuid(1)]);
  });

  it('giữ nguyên `nextCursor` và số trang', () => {
    queryClient.setQueryData(
      messagesQueryKey(BUYER, CONVERSATION_ID),
      messagesData(
        [makeMessage({ id: uuid(2), createdAt: at(2) })],
        [makeMessage({ id: uuid(1) })],
      ),
    );

    upsertServerMessage(queryClient, BUYER, makeMessage({ id: uuid(3), createdAt: at(3) }));

    const data = queryClient.getQueryData<MessagesData>(messagesQueryKey(BUYER, CONVERSATION_ID));
    expect(data?.pages).toHaveLength(2);
    expect(data?.pages[0].nextCursor).toBe('cursor-0');
    expect(data?.pages[1].nextCursor).toBeNull();
  });

  it('chỉ ghi vào cache của ĐÚNG phạm vi và hội thoại', () => {
    queryClient.setQueryData(messagesQueryKey(SHOP, CONVERSATION_ID), messagesData([]));
    queryClient.setQueryData(messagesQueryKey(BUYER, OTHER_CONVERSATION_ID), messagesData([]));

    const written = upsertServerMessage(queryClient, BUYER, makeMessage());

    expect(written).toBe(false); // người mua chưa nạp hội thoại này
    expect(itemsOf(SHOP)).toEqual([[]]);
    expect(itemsOf(BUYER, OTHER_CONVERSATION_ID)).toEqual([[]]);
  });
});

describe('bumpConversationWithMessage', () => {
  const seedList = (...summaries: ReturnType<typeof makeSummary>[]) =>
    queryClient.setQueryData(conversationsQueryKey(BUYER), conversationsData(summaries));

  it('danh sách chưa nạp ⇒ no-cache, không tạo cache giả', () => {
    const result = bumpConversationWithMessage(queryClient, BUYER, makeMessage(), 'BUYER');

    expect(result).toEqual({ status: 'no-cache', previousUnread: 0 });
    expect(queryClient.getQueryData(conversationsQueryKey(BUYER))).toBeUndefined();
  });

  it('danh sách đã nạp nhưng chưa có hội thoại (tin đầu tiên của hội thoại MỚI) ⇒ missing', () => {
    seedList(makeSummary({ id: OTHER_CONVERSATION_ID }));

    const result = bumpConversationWithMessage(queryClient, BUYER, makeMessage(), 'BUYER');

    expect(result).toEqual({ status: 'missing', previousUnread: 0 });
    expect(listOf()).toEqual([[OTHER_CONVERSATION_ID]]);
  });

  it('tin của ĐỐI PHƯƠNG: cập nhật tin cuối + thời gian, chưa đọc +1, đẩy hội thoại lên đầu', () => {
    seedList(
      makeSummary({ id: OTHER_CONVERSATION_ID, lastMessageAt: at(5) }),
      makeSummary({ id: CONVERSATION_ID, lastMessageAt: at(1), unreadCount: 2 }),
    );

    const result = bumpConversationWithMessage(
      queryClient,
      BUYER,
      makeMessage({ senderRole: 'SHOP', content: 'tin mới', createdAt: at(10) }),
      'BUYER',
    );

    const data = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(result).toEqual({ status: 'updated', previousUnread: 2 });
    expect(listOf()).toEqual([[CONVERSATION_ID, OTHER_CONVERSATION_ID]]);
    expect(data?.pages[0].items[0]).toMatchObject({
      unreadCount: 3,
      lastMessageAt: at(10),
      lastMessage: { content: 'tin mới', senderRole: 'SHOP', createdAt: at(10) },
    });
  });

  it('tin của CHÍNH MÌNH: chưa đọc về 0 (gửi một tin là đã đọc mọi thứ trước nó)', () => {
    seedList(makeSummary({ unreadCount: 4, lastMessageAt: at(1) }));

    const result = bumpConversationWithMessage(
      queryClient,
      BUYER,
      makeMessage({ senderRole: 'BUYER', createdAt: at(2) }),
      'BUYER',
    );

    const data = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(result.previousUnread).toBe(4);
    expect(data?.pages[0].items[0].unreadCount).toBe(0);
  });

  it('vai người xem quyết định thế nào là "đối phương": chủ shop nhận tin của người mua ⇒ +1', () => {
    queryClient.setQueryData(
      conversationsQueryKey(SHOP),
      conversationsData([makeSummary({ unreadCount: 0, lastMessageAt: at(0) })]),
    );

    bumpConversationWithMessage(
      queryClient,
      SHOP,
      makeMessage({ senderRole: 'BUYER', createdAt: at(1) }),
      'SHOP',
    );

    const data = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(SHOP));
    expect(data?.pages[0].items[0].unreadCount).toBe(1);
  });

  it('danh sách đã phản ánh tin này (lastMessageAt >= thời gian tin) ⇒ KHÔNG đổi gì, không đếm đôi chưa đọc', () => {
    seedList(makeSummary({ unreadCount: 3, lastMessageAt: at(10) }));
    const before = queryClient.getQueryData(conversationsQueryKey(BUYER));

    const equal = bumpConversationWithMessage(
      queryClient,
      BUYER,
      makeMessage({ senderRole: 'SHOP', createdAt: at(10) }),
      'BUYER',
    );
    const older = bumpConversationWithMessage(
      queryClient,
      BUYER,
      makeMessage({ senderRole: 'SHOP', createdAt: at(5) }),
      'BUYER',
    );

    // `previousUnread` 0: không xoá chưa đọc nào, nơi gọi không được trừ gì khỏi huy hiệu.
    expect(equal).toEqual({ status: 'updated', previousUnread: 0 });
    expect(older).toEqual({ status: 'updated', previousUnread: 0 });
    expect(queryClient.getQueryData(conversationsQueryKey(BUYER))).toBe(before);
  });

  it('hội thoại chưa có tin nào (lastMessageAt null) vẫn nhận tin đầu tiên', () => {
    seedList(makeSummary({ lastMessage: null, lastMessageAt: null }));

    bumpConversationWithMessage(
      queryClient,
      BUYER,
      makeMessage({ senderRole: 'SHOP', createdAt: at(1) }),
      'BUYER',
    );

    const data = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(data?.pages[0].items[0].lastMessageAt).toBe(at(1));
  });

  it('tin cuối được rút gọn như BE: gộp xuống dòng và cắt ở 100 ký tự', () => {
    seedList(makeSummary({ lastMessageAt: at(0) }));

    bumpConversationWithMessage(
      queryClient,
      BUYER,
      makeMessage({ content: `a\nb ${'x'.repeat(300)}`, createdAt: at(1) }),
      'BUYER',
    );

    const data = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    const preview = data?.pages[0].items[0].lastMessage?.content ?? '';
    expect(preview.startsWith('a b xxx')).toBe(true);
    expect(Array.from(preview)).toHaveLength(100);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('hội thoại ở trang sau được chuyển lên ĐẦU trang đầu, không nhân đôi', () => {
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData(
        [makeSummary({ id: OTHER_CONVERSATION_ID, lastMessageAt: at(9) })],
        [makeSummary({ id: CONVERSATION_ID, lastMessageAt: at(1) })],
      ),
    );

    bumpConversationWithMessage(
      queryClient,
      BUYER,
      makeMessage({ senderRole: 'SHOP', createdAt: at(10) }),
      'BUYER',
    );

    expect(listOf()).toEqual([[CONVERSATION_ID, OTHER_CONVERSATION_ID], []]);
  });
});

describe('clearConversationUnread', () => {
  it('đưa chưa đọc của đúng hội thoại về 0 và trả số trước đó', () => {
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([
        makeSummary({ id: CONVERSATION_ID, unreadCount: 3 }),
        makeSummary({ id: OTHER_CONVERSATION_ID, unreadCount: 5 }),
      ]),
    );

    const previous = clearConversationUnread(queryClient, BUYER, CONVERSATION_ID);

    const data = queryClient.getQueryData<ConversationsData>(conversationsQueryKey(BUYER));
    expect(previous).toBe(3);
    expect(findConversation(data, CONVERSATION_ID)?.unreadCount).toBe(0);
    expect(findConversation(data, OTHER_CONVERSATION_ID)?.unreadCount).toBe(5);
  });

  it('không có trong cache, hoặc đã 0 ⇒ trả 0 và không ghi', () => {
    expect(clearConversationUnread(queryClient, BUYER, CONVERSATION_ID)).toBe(0);
    queryClient.setQueryData(
      conversationsQueryKey(BUYER),
      conversationsData([makeSummary({ unreadCount: 0 })]),
    );
    const before = queryClient.getQueryData(conversationsQueryKey(BUYER));

    expect(clearConversationUnread(queryClient, BUYER, CONVERSATION_ID)).toBe(0);
    expect(queryClient.getQueryData(conversationsQueryKey(BUYER))).toBe(before);
  });
});

describe('adjustUnreadCount', () => {
  it('cộng/trừ vào tổng đã có, không bao giờ xuống dưới 0', () => {
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 5 });

    adjustUnreadCount(queryClient, BUYER, -3);
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 2 });
    adjustUnreadCount(queryClient, BUYER, -10);
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 0 });
    adjustUnreadCount(queryClient, BUYER, 4);
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toEqual({ unreadCount: 4 });
  });

  it('chưa có cache hoặc delta 0 ⇒ không làm gì (không tạo cache giả)', () => {
    adjustUnreadCount(queryClient, BUYER, 3);
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toBeUndefined();

    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 1 });
    const before = queryClient.getQueryData(unreadCountQueryKey(BUYER));
    adjustUnreadCount(queryClient, BUYER, 0);
    expect(queryClient.getQueryData(unreadCountQueryKey(BUYER))).toBe(before);
  });

  it('chỉ đổi huy hiệu của ĐÚNG phạm vi', () => {
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(BUYER), { unreadCount: 5 });
    queryClient.setQueryData<UnreadCount>(unreadCountQueryKey(SHOP), { unreadCount: 7 });

    adjustUnreadCount(queryClient, BUYER, -2);

    expect(queryClient.getQueryData(unreadCountQueryKey(SHOP))).toEqual({ unreadCount: 7 });
  });
});

describe('setOtherReadMark', () => {
  it('ghi mốc đối phương đã đọc; chỉ TĂNG, sự kiện đến muộn không làm lùi', () => {
    setOtherReadMark(queryClient, CONVERSATION_ID, at(5));
    setOtherReadMark(queryClient, CONVERSATION_ID, at(3));
    expect(queryClient.getQueryData(otherReadMarkQueryKey(CONVERSATION_ID))).toBe(at(5));

    setOtherReadMark(queryClient, CONVERSATION_ID, at(9));
    expect(queryClient.getQueryData(otherReadMarkQueryKey(CONVERSATION_ID))).toBe(at(9));
  });

  it('mỗi hội thoại một mốc riêng', () => {
    setOtherReadMark(queryClient, CONVERSATION_ID, at(5));
    setOtherReadMark(queryClient, OTHER_CONVERSATION_ID, at(1));

    expect(queryClient.getQueryData(otherReadMarkQueryKey(OTHER_CONVERSATION_ID))).toBe(at(1));
  });
});
