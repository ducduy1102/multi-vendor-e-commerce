import { describe, expect, it } from 'vitest';

import { CONVERSATION_ID, at, makeMessage, messagesData, uuid } from '../chat-test-data';
import type { OutboxItem } from '../store/chat-outbox.store';
import {
  PENDING_ID_PREFIX,
  flattenServerMessages,
  isPendingMessage,
  isSeenByOther,
  latestReadMark,
  mergeMessagesWithOutbox,
} from './chat-messages';

const outboxItem = (overrides: Partial<OutboxItem> = {}): OutboxItem => ({
  clientMessageId: uuid(900),
  conversationId: CONVERSATION_ID,
  senderRole: 'BUYER',
  content: 'đang gửi',
  createdAt: at(100),
  deliveryStatus: 'sending',
  ...overrides,
});

describe('flattenServerMessages', () => {
  it('ghép các trang theo thứ tự (mới nhất trước)', () => {
    const data = messagesData(
      [makeMessage({ id: uuid(3) }), makeMessage({ id: uuid(2) })],
      [makeMessage({ id: uuid(1) })],
    );

    expect(flattenServerMessages(data).map((m) => m.id)).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  it('trùng id giữa các trang (tin mới chen vào làm lệch trang) chỉ giữ MỘT, ưu tiên bản ở trang trước', () => {
    const data = messagesData(
      [makeMessage({ id: uuid(2), content: 'bản đầu' })],
      [makeMessage({ id: uuid(2), content: 'bản sau' }), makeMessage({ id: uuid(1) })],
    );

    const result = flattenServerMessages(data);

    expect(result.map((m) => m.id)).toEqual([uuid(2), uuid(1)]);
    expect(result[0].content).toBe('bản đầu');
  });

  it('chưa có dữ liệu ⇒ mảng rỗng', () => {
    expect(flattenServerMessages(undefined)).toEqual([]);
    expect(flattenServerMessages({ pages: [] })).toEqual([]);
  });
});

describe('mergeMessagesWithOutbox', () => {
  const server = [
    makeMessage({ id: uuid(2), createdAt: at(2) }),
    makeMessage({ id: uuid(1), createdAt: at(1) }),
  ];

  it('không có hộp chờ ⇒ chính danh sách server', () => {
    expect(mergeMessagesWithOutbox(server, [])).toEqual(server);
  });

  it('tin đang gửi / gửi lỗi nằm TRÊN CÙNG (mới nhất), bất kể đồng hồ máy khách', () => {
    const farPast = outboxItem({
      clientMessageId: uuid(901),
      createdAt: '2000-01-01T00:00:00.000Z',
    });

    const result = mergeMessagesWithOutbox(server, [farPast]);

    expect(result[0].clientMessageId).toBe(uuid(901));
    expect(result.slice(1)).toEqual(server);
  });

  it('tin tạm có id `pending:<clientMessageId>`, giữ trạng thái và lý do lỗi', () => {
    const failed = outboxItem({
      deliveryStatus: 'failed',
      failure: { status: 429, code: 'CHAT_RATE_LIMITED' },
    });

    const [view] = mergeMessagesWithOutbox([], [failed]);

    expect(view.id).toBe(`${PENDING_ID_PREFIX}${failed.clientMessageId}`);
    expect(isPendingMessage(view)).toBe(true);
    expect(view).toMatchObject({
      conversationId: CONVERSATION_ID,
      senderRole: 'BUYER',
      content: 'đang gửi',
      deliveryStatus: 'failed',
      failure: { status: 429, code: 'CHAT_RATE_LIMITED' },
    });
  });

  it('tin đang gửi không có trường failure (không lẫn undefined khoá)', () => {
    const [view] = mergeMessagesWithOutbox([], [outboxItem()]);

    expect(view).not.toHaveProperty('failure');
    expect(view.deliveryStatus).toBe('sending');
  });

  it('nhiều tin chờ giữ nguyên thứ tự của hộp chờ (mới nhất trước)', () => {
    const newest = outboxItem({ clientMessageId: uuid(902) });
    const older = outboxItem({ clientMessageId: uuid(901) });

    const result = mergeMessagesWithOutbox(server, [newest, older]);

    expect(result.slice(0, 2).map((m) => m.clientMessageId)).toEqual([uuid(902), uuid(901)]);
  });

  it('tin chờ mà server ĐÃ có bản cùng clientMessageId thì ẩn đi — không bao giờ hiện hai lần một tin', () => {
    const delivered = makeMessage({ id: uuid(3), clientMessageId: uuid(900), createdAt: at(3) });

    const result = mergeMessagesWithOutbox([delivered, ...server], [outboxItem()]);

    expect(result.map((m) => m.id)).toEqual([uuid(3), uuid(2), uuid(1)]);
    expect(result.some(isPendingMessage)).toBe(false);
  });

  it('chỉ ẩn đúng tin đã giao: tin chờ khác vẫn hiện', () => {
    const delivered = makeMessage({ id: uuid(3), clientMessageId: uuid(900) });
    const stillPending = outboxItem({ clientMessageId: uuid(901), deliveryStatus: 'failed' });

    const result = mergeMessagesWithOutbox([delivered], [outboxItem(), stillPending]);

    expect(result.map((m) => m.clientMessageId)).toEqual([uuid(901), uuid(900)]);
  });

  it('isPendingMessage chỉ đúng với tin tạm', () => {
    expect(isPendingMessage({ id: `${PENDING_ID_PREFIX}abc` })).toBe(true);
    expect(isPendingMessage({ id: uuid(1) })).toBe(false);
  });
});

describe('latestReadMark', () => {
  it('lấy mốc MỚI hơn trong hai nguồn', () => {
    expect(latestReadMark(at(1), at(5))).toBe(at(5));
    expect(latestReadMark(at(5), at(1))).toBe(at(5));
    expect(latestReadMark(at(3), at(3))).toBe(at(3));
  });

  it('thiếu một nguồn (null/undefined) thì dùng nguồn còn lại; thiếu cả hai ⇒ null', () => {
    expect(latestReadMark(null, at(2))).toBe(at(2));
    expect(latestReadMark(at(2), undefined)).toBe(at(2));
    expect(latestReadMark(undefined, null)).toBeNull();
    expect(latestReadMark(null, null)).toBeNull();
  });
});

describe('isSeenByOther', () => {
  const own = { id: uuid(1), senderRole: 'BUYER' as const, createdAt: at(5) };

  it('tin của MÌNH có createdAt <= mốc đối phương đã đọc ⇒ đã xem (biên: bằng mốc cũng là đã xem)', () => {
    expect(isSeenByOther(own, 'BUYER', at(5))).toBe(true);
    expect(isSeenByOther(own, 'BUYER', at(9))).toBe(true);
  });

  it('tin gửi SAU mốc đọc ⇒ chưa xem', () => {
    expect(isSeenByOther(own, 'BUYER', at(4))).toBe(false);
  });

  it('chưa biết mốc (null/undefined) ⇒ chưa xem', () => {
    expect(isSeenByOther(own, 'BUYER', null)).toBe(false);
    expect(isSeenByOther(own, 'BUYER', undefined)).toBe(false);
  });

  it('tin của ĐỐI PHƯƠNG không bao giờ "được xem" theo nghĩa này, kể cả khi mốc đã qua', () => {
    expect(isSeenByOther({ ...own, senderRole: 'SHOP' }, 'BUYER', at(99))).toBe(false);
  });

  it('vai người xem quyết định tin nào là của mình: chủ shop xem tin của SHOP', () => {
    const shopMessage = { ...own, senderRole: 'SHOP' as const };
    expect(isSeenByOther(shopMessage, 'SHOP', at(9))).toBe(true);
    expect(isSeenByOther(own, 'SHOP', at(9))).toBe(false);
  });

  it('tin tạm (đang gửi / gửi lỗi) chưa lên server nên không bao giờ "đã xem"', () => {
    const pending = { ...own, id: `${PENDING_ID_PREFIX}${uuid(50)}`, createdAt: at(1) };
    expect(isSeenByOther(pending, 'BUYER', at(99))).toBe(false);
  });
});
