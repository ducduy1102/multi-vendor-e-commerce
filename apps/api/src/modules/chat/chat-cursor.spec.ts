import { chatCursorSchema } from '@ecommerce/types';
import { decodeChatCursor, encodeChatCursor } from './chat-cursor';

const ID = '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10';
const AT = new Date('2030-01-02T12:00:00.123Z');

const encodeText = (text: string) =>
  Buffer.from(text, 'utf8').toString('base64url');

describe('chat cursor', () => {
  it('mã hoá rồi giải mã trả đúng (mốc thời gian, id)', () => {
    const cursor = encodeChatCursor({ at: AT, id: ID });

    expect(decodeChatCursor(cursor)).toEqual({ at: AT, id: ID });
  });

  it('giữ nguyên MILI-GIÂY — hai tin cách nhau 1ms có con trỏ khác nhau', () => {
    const a = encodeChatCursor({
      at: new Date('2030-01-02T12:00:00.001Z'),
      id: ID,
    });
    const b = encodeChatCursor({
      at: new Date('2030-01-02T12:00:00.002Z'),
      id: ID,
    });

    expect(a).not.toBe(b);
    expect(decodeChatCursor(a)?.at.getTime()).toBe(
      new Date('2030-01-02T12:00:00.001Z').getTime(),
    );
  });

  it('cùng mili-giây khác id ⇒ con trỏ khác nhau (id là khoá phụ)', () => {
    const other = '0c9e5b1a-7d3e-4a3f-8b21-5a6d9c2e4f10';

    expect(encodeChatCursor({ at: AT, id: ID })).not.toBe(
      encodeChatCursor({ at: AT, id: other }),
    );
  });

  it('con trỏ sinh ra luôn qua được chatCursorSchema (bộ ký tự + độ dài ≤ 120)', () => {
    const cursor = encodeChatCursor({ at: AT, id: ID });

    expect(chatCursorSchema.safeParse(cursor).success).toBe(true);
    expect(cursor.length).toBeLessThanOrEqual(120);
  });

  it.each([
    ['chuỗi rỗng', ''],
    ['không phải base64url', '!!!not-base64!!!'],
    ['có dấu cách', 'abc def'],
    ['SQL', encodeText("2030-01-02T12:00:00.123Z|' OR 1=1 --")],
    ['quá dài (> 120 ký tự)', 'A'.repeat(121)],
    ['thiếu dấu phân cách', encodeText(`2030-01-02T12:00:00.123Z${ID}`)],
    ['thiếu id', encodeText('2030-01-02T12:00:00.123Z|')],
    ['id không phải UUID', encodeText('2030-01-02T12:00:00.123Z|not-a-uuid')],
    [
      'id chữ HOA (không phải dạng chuẩn do BE sinh)',
      encodeText(`2030-01-02T12:00:00.123Z|${ID.toUpperCase()}`),
    ],
    ['thời gian không có mili-giây', encodeText(`2030-01-02T12:00:00Z|${ID}`)],
    [
      'thời gian có múi giờ lệch',
      encodeText(`2030-01-02T12:00:00.123+07:00|${ID}`),
    ],
    ['thời gian không phải ngày', encodeText(`hello|${ID}`)],
    [
      'năm mở rộng (+275760) — Date hợp lệ và tự khớp toISOString, chỉ regex chặn được',
      encodeText(`+275760-09-13T00:00:00.000Z|${ID}`),
    ],
    [
      'ngày không tồn tại (31/02)',
      encodeText(`2030-02-31T00:00:00.000Z|${ID}`),
    ],
    ['tháng 13', encodeText(`2030-13-01T00:00:00.000Z|${ID}`)],
    ['id đi kèm đuôi thừa', encodeText(`2030-01-02T12:00:00.123Z|${ID}|x`)],
    ['id kèm khoảng trắng', encodeText(`2030-01-02T12:00:00.123Z|${ID} `)],
    ['đường dẫn', encodeText('../../etc/passwd')],
  ])('con trỏ không hợp lệ (%s) ⇒ null', (_name, raw) => {
    expect(decodeChatCursor(raw)).toBeNull();
  });

  it('cách viết base64url KHÔNG chuẩn của cùng nội dung bị loại (chỉ một dạng duy nhất được nhận)', () => {
    const canonical = encodeChatCursor({ at: AT, id: ID });
    // 61 byte = 488 bit nhưng 82 ký tự mang 492 bit ⇒ 4 bit cuối của ký tự cuối là bit thừa: đảo bit thấp nhất của
    // ký tự đó cho ra chuỗi KHÁC mà giải mã ra đúng cùng các byte.
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const variant =
      canonical.slice(0, -1) +
      alphabet[alphabet.indexOf(canonical.slice(-1)) ^ 1];

    expect(variant).not.toBe(canonical);
    expect(
      Buffer.from(variant, 'base64url').equals(
        Buffer.from(canonical, 'base64url'),
      ),
    ).toBe(true);
    expect(decodeChatCursor(variant)).toBeNull();
  });
});
