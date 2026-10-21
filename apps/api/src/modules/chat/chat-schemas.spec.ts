import {
  CHAT_CONVERSATIONS_PAGE_SIZE,
  CHAT_MAX_PAGE_SIZE,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  chatMessageEventSchema,
  chatMessageFormSchema,
  chatMessageSchema,
  conversationListQuerySchema,
  conversationListSchema,
  conversationSummarySchema,
  ERROR_CODES,
  isErrorCode,
  markReadResultSchema,
  messageListQuerySchema,
  messageListSchema,
  openConversationSchema,
  sendMessageSchema,
  unreadCountSchema,
} from '@ecommerce/types';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Schema dùng chung của chat (packages/types/src/chat.ts, Week10.md 4.2). Là hợp đồng giữa BE và FE nên test ở
// đây khoá hình dạng: nội dung được chuẩn hoá/kiểm thế nào, client KHÔNG nhét được trường nào vào, và con số
// 1000 khớp với CHECK của DB.
const UUID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';
const OTHER_UUID = '9b1e0c52-3f64-4a8e-b6a2-5d7c8e1f2a33';
const ISO = '2030-01-01T10:00:00.000Z';

const contentOf = (content: unknown) =>
  sendMessageSchema.safeParse({ content, clientMessageId: UUID });
const errorMessages = (result: ReturnType<typeof contentOf>) =>
  result.success ? [] : result.error.issues.map((issue) => issue.message);

describe('nội dung tin nhắn (sendMessageSchema.content)', () => {
  describe('chấp nhận và chuẩn hoá', () => {
    it.each([
      ['văn bản thường', 'xin chào shop', 'xin chào shop'],
      [
        'tiếng Việt có dấu',
        'Còn hàng màu đỏ không ạ?',
        'Còn hàng màu đỏ không ạ?',
      ],
      ['cắt khoảng trắng hai đầu', '   có sẵn không   ', 'có sẵn không'],
      ['cắt cả xuống dòng ở hai đầu', '\n\nhello\n\n', 'hello'],
      [
        'giữ xuống dòng ở giữa',
        'dòng 1\ndòng 2\n\ndòng 4',
        'dòng 1\ndòng 2\n\ndòng 4',
      ],
      ['chuẩn hoá CRLF → LF', 'a\r\nb\r\nc', 'a\nb\nc'],
      ['chuẩn hoá CR trần → LF', 'a\rb', 'a\nb'],
      [
        '<script> được giữ NGUYÊN như chữ',
        '<script>alert(1)</script>',
        '<script>alert(1)</script>',
      ],
      [
        '<img onerror> được giữ NGUYÊN như chữ',
        '<img src=x onerror=alert(1)>',
        '<img src=x onerror=alert(1)>',
      ],
      ['dấu < > thông thường', 'size < 5kg và > 2kg', 'size < 5kg và > 2kg'],
      ['emoji', 'cảm ơn shop 😀👍', 'cảm ơn shop 😀👍'],
      ['emoji ghép bằng ZWJ', '👨‍👩‍👧', '👨‍👩‍👧'],
    ])('%s', (_name, input, expected) => {
      const result = contentOf(input);

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.content).toBe(expected);
    });

    it(`đúng ${CHAT_MESSAGE_MAX_LENGTH} ký tự vẫn qua`, () => {
      expect(contentOf('a'.repeat(CHAT_MESSAGE_MAX_LENGTH)).success).toBe(true);
    });

    it('độ dài tính SAU khi cắt khoảng trắng và chuẩn hoá: 1000 ký tự bọc trong khoảng trắng vẫn qua', () => {
      const padded = `  ${'a'.repeat(CHAT_MESSAGE_MAX_LENGTH)}  `;

      const result = contentOf(padded);

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data.content).toHaveLength(CHAT_MESSAGE_MAX_LENGTH);
    });
  });

  describe('từ chối: thiếu hoặc rỗng', () => {
    it.each([
      ['chuỗi rỗng', ''],
      ['chỉ khoảng trắng', '    '],
      ['chỉ xuống dòng', '\n\n\n'],
      ['chỉ CRLF', '\r\n\r\n'],
      ['undefined', undefined],
      ['null', null],
      ['số', 123],
      ['object', { a: 1 }],
      ['mảng', ['x']],
    ])('%s ⇒ validationMessageRequired', (_name, input) => {
      expect(errorMessages(contentOf(input))).toEqual([
        'chat.validationMessageRequired',
      ]);
    });

    it('thiếu hẳn trường content', () => {
      const result = sendMessageSchema.safeParse({ clientMessageId: UUID });

      expect(result.success).toBe(false);
    });
  });

  describe('từ chối: quá dài', () => {
    it.each([
      [`${CHAT_MESSAGE_MAX_LENGTH + 1} ký tự`, CHAT_MESSAGE_MAX_LENGTH + 1],
      ['5000 ký tự', 5000],
    ])('%s ⇒ validationMessageTooLong', (_name, length) => {
      expect(errorMessages(contentOf('a'.repeat(length)))).toEqual([
        'chat.validationMessageTooLong',
      ]);
    });

    it('Zod đếm đơn vị UTF-16 nên chặt hơn CHECK của DB: 501 emoji (1002 đơn vị) bị từ chối ở Zod', () => {
      expect(errorMessages(contentOf('😀'.repeat(501)))).toEqual([
        'chat.validationMessageTooLong',
      ]);
    });
  });

  describe('từ chối: ký tự không an toàn ⇒ validationMessageUnsafe', () => {
    it.each([
      ['NUL', '\u0000'],
      ['BEL', '\u0007'],
      ['backspace', '\u0008'],
      ['tab', '\t'],
      ['vertical tab', '\u000b'],
      ['form feed', '\u000c'],
      ['ESC', '\u001b'],
      ['DEL', '\u007f'],
      ['điều khiển C1 (NEL)', '\u0085'],
      ['bidi-override RLO', '‮'],
      ['bidi-override LRE', '‪'],
      ['bidi isolate LRI', '⁦'],
      ['bidi isolate PDI', '⁩'],
      ['BOM / zero-width no-break space', '﻿'],
      ['dấu phân dòng Unicode', ' '],
      ['dấu phân đoạn Unicode', ' '],
    ])('%s ở giữa câu', (_name, char) => {
      expect(errorMessages(contentOf(`xin${char}chào`))).toEqual([
        'chat.validationMessageUnsafe',
      ]);
    });

    it('ký tự không an toàn nằm sát đầu/cuối cũng bị chặn (không bị trim nuốt mất)', () => {
      expect(contentOf('hello\u0000').success).toBe(false);
      expect(contentOf('‮hello').success).toBe(false);
    });

    it('vừa quá dài vừa không an toàn ⇒ báo cả hai lỗi', () => {
      const messages = errorMessages(
        contentOf(`\u0000${'a'.repeat(CHAT_MESSAGE_MAX_LENGTH)}`),
      );

      expect(messages).toEqual(
        expect.arrayContaining([
          'chat.validationMessageTooLong',
          'chat.validationMessageUnsafe',
        ]),
      );
    });
  });
});

describe('sendMessageSchema', () => {
  it('chỉ giữ content + clientMessageId: client KHÔNG nhét được người gửi/hội thoại/thời điểm vào', () => {
    const parsed = sendMessageSchema.parse({
      content: 'hi',
      clientMessageId: UUID,
      senderId: 'victim',
      conversationId: OTHER_UUID,
      createdAt: '1999-01-01T00:00:00.000Z',
      senderRole: 'SHOP',
    });

    expect(parsed).toEqual({ content: 'hi', clientMessageId: UUID });
  });

  it.each([
    ['thiếu', undefined],
    ['không phải UUID', 'abc'],
    ['rỗng', ''],
    ['số', 1],
  ])('clientMessageId %s ⇒ từ chối', (_name, clientMessageId) => {
    expect(
      sendMessageSchema.safeParse({ content: 'hi', clientMessageId }).success,
    ).toBe(false);
  });

  it('clientMessageId viết hoa vẫn hợp lệ', () => {
    expect(
      sendMessageSchema.safeParse({
        content: 'hi',
        clientMessageId: UUID.toUpperCase(),
      }).success,
    ).toBe(true);
  });

  it('chatMessageFormSchema (ô nhập) chỉ có content', () => {
    expect(
      chatMessageFormSchema.parse({ content: ' hi ', clientMessageId: UUID }),
    ).toEqual({
      content: 'hi',
    });
  });
});

describe('openConversationSchema', () => {
  it('nhận shopId là UUID và bỏ mọi trường khác', () => {
    expect(
      openConversationSchema.parse({ shopId: UUID, buyerId: 'victim' }),
    ).toEqual({
      shopId: UUID,
    });
  });

  it.each([
    ['thiếu', undefined],
    ['slug thay vì UUID', 'shop-cua-toi'],
    ['rỗng', ''],
    ['số', 5],
  ])('shopId %s ⇒ từ chối', (_name, shopId) => {
    expect(openConversationSchema.safeParse({ shopId }).success).toBe(false);
  });
});

describe('query phân trang', () => {
  it('mặc định: tin 30/trang, hội thoại 20/trang, không có con trỏ', () => {
    expect(messageListQuerySchema.parse({})).toEqual({ limit: CHAT_PAGE_SIZE });
    expect(conversationListQuerySchema.parse({})).toEqual({
      limit: CHAT_CONVERSATIONS_PAGE_SIZE,
    });
  });

  it('query string là chuỗi ⇒ tự ép sang số', () => {
    expect(messageListQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it.each([
    ['0', '0'],
    ['âm', '-1'],
    [`quá trần (${CHAT_MAX_PAGE_SIZE + 1})`, String(CHAT_MAX_PAGE_SIZE + 1)],
    ['số thập phân', '1.5'],
    ['chữ', 'abc'],
  ])('limit %s ⇒ từ chối', (_name, limit) => {
    expect(messageListQuerySchema.safeParse({ limit }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ limit }).success).toBe(
      false,
    );
  });

  it(`limit đúng trần ${CHAT_MAX_PAGE_SIZE} và bằng 1 vẫn qua`, () => {
    expect(
      messageListQuerySchema.parse({ limit: String(CHAT_MAX_PAGE_SIZE) }).limit,
    ).toBe(CHAT_MAX_PAGE_SIZE);
    expect(messageListQuerySchema.parse({ limit: '1' }).limit).toBe(1);
  });

  it('con trỏ base64url hợp lệ qua', () => {
    const cursor = Buffer.from(`${ISO}|${UUID}`).toString('base64url');

    expect(messageListQuerySchema.parse({ before: cursor }).before).toBe(
      cursor,
    );
  });

  it.each([
    ['rỗng', ''],
    ['có khoảng trắng', 'abc def'],
    ['có dấu =', 'abc='],
    ['có dấu /', 'a/b'],
    ['đường dẫn lên thư mục cha', '../../etc'],
    ['mã hoá %', '%2e%2e'],
    ['SQL', "'; DROP TABLE messages;--"],
    ['quá dài (121 ký tự)', 'a'.repeat(121)],
  ])('con trỏ %s ⇒ từ chối', (_name, before) => {
    expect(messageListQuerySchema.safeParse({ before }).success).toBe(false);
    expect(conversationListQuerySchema.safeParse({ before }).success).toBe(
      false,
    );
  });
});

describe('schema response', () => {
  const counterpart = { name: 'Shop Áo', logoUrl: null };
  const summary = {
    id: UUID,
    shopId: OTHER_UUID,
    counterpart,
    lastMessage: { content: 'ok', senderRole: 'SHOP', createdAt: ISO },
    lastMessageAt: ISO,
    unreadCount: 3,
    otherLastReadAt: ISO,
    isReadOnly: false,
  };

  it('conversationSummarySchema: nhận hội thoại có tin và hội thoại vừa mở (lastMessage/lastMessageAt null)', () => {
    expect(conversationSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      conversationSummarySchema.safeParse({
        ...summary,
        lastMessage: null,
        lastMessageAt: null,
        otherLastReadAt: null,
      }).success,
    ).toBe(true);
  });

  it('conversationSummarySchema: KHÔNG bao giờ mang email/SĐT của đối phương — trường lạ bị loại', () => {
    const parsed = conversationSummarySchema.parse({
      ...summary,
      counterpart: {
        ...counterpart,
        email: 'buyer@example.com',
        phone: '0900000000',
      },
      buyerId: 'victim',
    });

    expect(parsed.counterpart).toEqual(counterpart);
    expect(JSON.stringify(parsed)).not.toMatch(
      /example\.com|0900000000|victim/,
    );
  });

  it.each([
    ['unreadCount âm', { unreadCount: -1 }],
    ['unreadCount thập phân', { unreadCount: 1.5 }],
    ['isReadOnly thiếu', { isReadOnly: undefined }],
    ['otherLastReadAt thiếu', { otherLastReadAt: undefined }],
    ['otherLastReadAt không phải ISO', { otherLastReadAt: 'hôm qua' }],
    ['id không phải UUID', { id: 'abc' }],
    ['lastMessageAt không phải ISO', { lastMessageAt: 'hôm qua' }],
  ])('conversationSummarySchema từ chối %s', (_name, override) => {
    expect(
      conversationSummarySchema.safeParse({ ...summary, ...override }).success,
    ).toBe(false);
  });

  const message = {
    id: UUID,
    conversationId: OTHER_UUID,
    senderRole: 'BUYER',
    content: 'xin chào',
    createdAt: ISO,
  };

  it('chatMessageSchema: clientMessageId tuỳ chọn (thiếu, null hoặc UUID đều qua)', () => {
    expect(chatMessageSchema.safeParse(message).success).toBe(true);
    expect(
      chatMessageSchema.safeParse({ ...message, clientMessageId: null })
        .success,
    ).toBe(true);
    expect(
      chatMessageSchema.safeParse({ ...message, clientMessageId: UUID })
        .success,
    ).toBe(true);
    expect(
      chatMessageSchema.safeParse({ ...message, clientMessageId: 'x' }).success,
    ).toBe(false);
  });

  it.each([
    ['vai lạ', { senderRole: 'ADMIN' }],
    ['thời điểm không phải ISO', { createdAt: '2030-01-01' }],
    ['thiếu nội dung', { content: undefined }],
    ['senderId lạ KHÔNG làm hỏng nhưng bị loại', {}],
  ])('chatMessageSchema: %s', (name, override) => {
    const result = chatMessageSchema.safeParse({
      ...message,
      ...override,
      senderId: 'victim',
    });

    if (name.startsWith('senderId')) {
      expect(result.success).toBe(true);
      expect(result.success && 'senderId' in result.data).toBe(false);
    } else {
      expect(result.success).toBe(false);
    }
  });

  it('danh sách: nextCursor là null hoặc con trỏ hợp lệ', () => {
    expect(
      conversationListSchema.safeParse({ items: [summary], nextCursor: null })
        .success,
    ).toBe(true);
    expect(
      messageListSchema.safeParse({ items: [message], nextCursor: 'abc_-9' })
        .success,
    ).toBe(true);
    expect(
      messageListSchema.safeParse({ items: [message], nextCursor: 'a b' })
        .success,
    ).toBe(false);
    expect(messageListSchema.safeParse({ items: [message] }).success).toBe(
      false,
    );
  });

  it('unreadCount và markRead', () => {
    expect(unreadCountSchema.safeParse({ unreadCount: 0 }).success).toBe(true);
    expect(unreadCountSchema.safeParse({ unreadCount: -1 }).success).toBe(
      false,
    );
    expect(markReadResultSchema.safeParse({ readAt: ISO }).success).toBe(true);
    expect(markReadResultSchema.safeParse({ readAt: 'x' }).success).toBe(false);
  });

  it('payload sự kiện chat:message: cần cả tin, vai của NGƯỜI NHẬN và shopId', () => {
    const event = { message, viewerRole: 'SHOP', shopId: OTHER_UUID };

    expect(chatMessageEventSchema.safeParse(event).success).toBe(true);
    expect(
      chatMessageEventSchema.safeParse({ ...event, viewerRole: undefined })
        .success,
    ).toBe(false);
    expect(
      chatMessageEventSchema.safeParse({ ...event, shopId: 'x' }).success,
    ).toBe(false);
    expect(
      chatMessageEventSchema.safeParse({ message, viewerRole: 'SHOP' }).success,
    ).toBe(false);
  });
});

describe('mã lỗi chat', () => {
  it.each([
    'CHAT_OWN_SHOP',
    'CHAT_SHOP_UNAVAILABLE',
    'CHAT_RATE_LIMITED',
    'CHAT_AWAITING_REPLY',
    'CHAT_CONVERSATION_LIMIT',
    'CHAT_NOT_PARTICIPANT',
  ])('%s đã đăng ký trong ERROR_CODES', (code) => {
    expect(isErrorCode(code)).toBe(true);
    expect(ERROR_CODES).toContain(code);
  });
});

describe('hằng số khớp CHECK của DB', () => {
  it('CHAT_MESSAGE_MAX_LENGTH bằng cận trên trong migration (đổi một nơi mà quên nơi kia là test đỏ)', () => {
    const migrationsDir = join(
      __dirname,
      '..',
      '..',
      '..',
      'prisma',
      'migrations',
    );
    const folder = readdirSync(migrationsDir).find((name) =>
      name.endsWith('_extend_conversation_for_chat'),
    );
    expect(folder).toBeDefined();
    const sql = readFileSync(
      join(migrationsDir, folder as string, 'migration.sql'),
      'utf8',
    );

    const match = /char_length\("content"\)\s+BETWEEN\s+1\s+AND\s+(\d+)/.exec(
      sql,
    );

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(CHAT_MESSAGE_MAX_LENGTH);
  });
});
