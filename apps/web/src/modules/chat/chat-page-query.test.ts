import { describe, expect, it } from 'vitest';

import { parseChatPageQuery } from './chat-page-query';
import { CONVERSATION_ID, OTHER_CONVERSATION_ID } from './chat-test-data';

describe('parseChatPageQuery', () => {
  it('?c=<uuid> hợp lệ ⇒ hội thoại đang chọn', () => {
    expect(parseChatPageQuery({ c: CONVERSATION_ID })).toEqual({ conversationId: CONVERSATION_ID });
  });

  it('không có ?c ⇒ chưa chọn', () => {
    expect(parseChatPageQuery({})).toEqual({ conversationId: null });
    expect(parseChatPageQuery({ c: undefined })).toEqual({ conversationId: null });
  });

  it.each([
    ['rỗng', ''],
    ['không phải UUID', 'abc'],
    ['UUID thiếu một ký tự', CONVERSATION_ID.slice(1)],
    ['kèm đường dẫn', `${CONVERSATION_ID}/../admin`],
    ['kèm query lạ', `${CONVERSATION_ID}?x=1`],
    ['kèm khoảng trắng', ` ${CONVERSATION_ID}`],
    ['mã chèn', '<script>alert(1)</script>'],
    ['SQL', "1' OR '1'='1"],
  ])('%s ⇒ chưa chọn (không bao giờ đi tiếp tới API)', (_label, value) => {
    expect(parseChatPageQuery({ c: value })).toEqual({ conversationId: null });
  });

  it('?c lặp nhiều lần ⇒ lấy giá trị đầu; nếu giá trị đầu sai thì chưa chọn (không "rơi" sang giá trị sau)', () => {
    expect(parseChatPageQuery({ c: [CONVERSATION_ID, OTHER_CONVERSATION_ID] })).toEqual({
      conversationId: CONVERSATION_ID,
    });
    expect(parseChatPageQuery({ c: ['abc', CONVERSATION_ID] })).toEqual({ conversationId: null });
    expect(parseChatPageQuery({ c: [] })).toEqual({ conversationId: null });
  });

  it('query khác (tab, page...) không ảnh hưởng', () => {
    expect(parseChatPageQuery({ tab: 'x', c: CONVERSATION_ID, page: '2' })).toEqual({
      conversationId: CONVERSATION_ID,
    });
  });
});
