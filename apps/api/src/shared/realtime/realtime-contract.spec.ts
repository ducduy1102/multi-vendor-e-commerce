import {
  chatReadPayloadSchema,
  chatTypingPayloadSchema,
  REALTIME_CONNECT_ERRORS,
  REALTIME_EVENTS,
} from '@ecommerce/types';

const ID = '2c6f6d3a-8d4b-4f55-9a52-0d9a2b6a7c11';

// Khoá hợp đồng chung với FE (packages/types): đổi tên sự kiện hay hình dạng payload là đổi giao thức.
describe('hợp đồng real-time (packages/types)', () => {
  it('tên sự kiện đúng dạng "<miền>:<hành động>" và không trùng nhau', () => {
    const names = Object.values(REALTIME_EVENTS);

    expect(names.sort()).toEqual([
      'auth:expired',
      'chat:message',
      'chat:read',
      'chat:typing',
      'notification:new',
    ]);
    for (const name of names) expect(name).toMatch(/^[a-z]+:[a-z]+$/);
  });

  it('lý do từ chối kết nối không trùng nhau và là chữ HOA_GẠCH_DƯỚI', () => {
    expect(new Set(REALTIME_CONNECT_ERRORS).size).toBe(
      REALTIME_CONNECT_ERRORS.length,
    );
    for (const reason of REALTIME_CONNECT_ERRORS)
      expect(reason).toMatch(/^[A-Z_]+$/);
  });

  describe('chat:typing', () => {
    it('chỉ cần conversationId (UUID); mọi trường khác bị loại — client không chỉ định được người nhận', () => {
      const parsed = chatTypingPayloadSchema.parse({
        conversationId: ID,
        toUserId: 'victim',
        content: 'x',
      });

      expect(parsed).toEqual({ conversationId: ID });
    });

    it.each([
      ['thiếu conversationId', {}],
      ['không phải UUID', { conversationId: 'abc' }],
      ['kiểu sai', { conversationId: 123 }],
      ['rỗng', { conversationId: '' }],
      ['null', null],
      ['chuỗi', 'x'],
    ])('từ chối: %s', (_name, payload) => {
      expect(chatTypingPayloadSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe('chat:read', () => {
    it('conversationId (UUID) + readAt (ISO)', () => {
      const payload = {
        conversationId: ID,
        readAt: '2030-01-01T10:00:00.000Z',
      };

      expect(chatReadPayloadSchema.parse(payload)).toEqual(payload);
    });

    it.each([
      ['thiếu readAt', { conversationId: ID }],
      ['readAt không phải ISO', { conversationId: ID, readAt: 'hôm qua' }],
      ['readAt là số', { conversationId: ID, readAt: 1_900_000_000 }],
      [
        'conversationId sai',
        { conversationId: 'x', readAt: '2030-01-01T00:00:00Z' },
      ],
    ])('từ chối: %s', (_name, payload) => {
      expect(chatReadPayloadSchema.safeParse(payload).success).toBe(false);
    });
  });
});
