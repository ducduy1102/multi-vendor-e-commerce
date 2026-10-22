import { z } from 'zod';
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor';

const ID = '8f14e45f-ceea-4672-9d6b-6f8e3a7c1d10';
const AT = new Date('2030-01-02T12:00:00.123Z');
// Schema bộ ký tự/độ dài do từng miền truyền vào (giống chatCursorSchema / notificationCursorSchema).
const SHAPE = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

const encodeText = (text: string) =>
  Buffer.from(text, 'utf8').toString('base64url');

describe('keyset cursor dùng chung', () => {
  it('mã hoá rồi giải mã trả đúng (mốc thời gian, id)', () => {
    expect(
      decodeKeysetCursor(encodeKeysetCursor({ at: AT, id: ID }), SHAPE),
    ).toEqual({ at: AT, id: ID });
  });

  it('giữ nguyên MILI-GIÂY và phân biệt hai id cùng mili-giây', () => {
    const other = '0c9e5b1a-7d3e-4a3f-8b21-5a6d9c2e4f10';
    const a = encodeKeysetCursor({ at: AT, id: ID });
    const b = encodeKeysetCursor({ at: AT, id: other });
    const c = encodeKeysetCursor({
      at: new Date('2030-01-02T12:00:00.124Z'),
      id: ID,
    });

    expect(new Set([a, b, c]).size).toBe(3);
    expect(decodeKeysetCursor(c, SHAPE)?.at.getTime()).toBe(AT.getTime() + 1);
  });

  it('con trỏ sinh ra luôn qua schema bộ ký tự (base64url, không đệm "=")', () => {
    const cursor = encodeKeysetCursor({ at: AT, id: ID });

    expect(SHAPE.safeParse(cursor).success).toBe(true);
    expect(cursor).not.toContain('=');
  });

  it('schema bộ ký tự do NƠI GỌI truyền vào được áp dụng (không chỉ kiểm định dạng nội bộ)', () => {
    const cursor = encodeKeysetCursor({ at: AT, id: ID });
    const tooShort = z.string().max(10);

    expect(decodeKeysetCursor(cursor, SHAPE)).not.toBeNull();
    expect(decodeKeysetCursor(cursor, tooShort)).toBeNull();
  });

  it.each([
    ['rỗng', ''],
    ['không có dấu |', encodeText('2030-01-02T12:00:00.123Z')],
    ['thời gian không phải ISO có mili-giây', encodeText(`2030-01-02|${ID}`)],
    ['thời gian thiếu mili-giây', encodeText(`2030-01-02T12:00:00Z|${ID}`)],
    [
      'ngày không tồn tại (31/02)',
      encodeText(`2030-02-31T12:00:00.000Z|${ID}`),
    ],
    ['id không phải UUID', encodeText('2030-01-02T12:00:00.123Z|abc')],
    [
      'id UUID VIẾT HOA',
      encodeText(`2030-01-02T12:00:00.123Z|${ID.toUpperCase()}`),
    ],
    ['id kèm đuôi lạ', encodeText(`2030-01-02T12:00:00.123Z|${ID}|(select 1)`)],
    ['chuỗi không phải base64url', 'a b!'],
    ['độ dài quá 120', 'A'.repeat(121)],
  ])('từ chối con trỏ %s', (_name, raw) => {
    expect(decodeKeysetCursor(raw, SHAPE)).toBeNull();
  });

  it('cách viết base64url KHÔNG chuẩn của cùng nội dung bị loại (chỉ một dạng duy nhất được nhận)', () => {
    const canonical = encodeKeysetCursor({ at: AT, id: ID });
    // Đổi ký tự cuối sang một ký tự khác cùng giải mã ra các byte giống nhau ở các bit thừa.
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = canonical[canonical.length - 1];
    const variants = [...alphabet]
      .filter((ch) => ch !== last)
      .map((ch) => canonical.slice(0, -1) + ch)
      .filter(
        (candidate) =>
          Buffer.from(candidate, 'base64url').toString('utf8') ===
          Buffer.from(canonical, 'base64url').toString('utf8'),
      );

    for (const variant of variants) {
      expect(decodeKeysetCursor(variant, SHAPE)).toBeNull();
    }
  });
});
