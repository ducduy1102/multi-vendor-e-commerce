import type { ZodTypeAny } from 'zod';

// Con trỏ phân trang "keyset" dùng chung (chat, thông báo — Week10.md 4.5, 7.6): cặp (mốc thời gian, id) của dòng CUỐI
// trang trước. Id là khoá phụ để hai dòng cùng mili-giây không bị trùng/mất giữa các trang. Với client đây là chuỗi MỜ —
// mã hoá ở MỘT nơi để chỉ một chỗ biết định dạng, và `decodeKeysetCursor` kiểm lại nghiêm ngặt vì con trỏ đi thẳng vào
// truy vấn DB. Mỗi miền truyền schema bộ ký tự/độ dài riêng của mình (chatCursorSchema, notificationCursorSchema...).
export interface KeysetCursor {
  at: Date;
  id: string;
}

const ISO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeKeysetCursor({ at, id }: KeysetCursor): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

// null = con trỏ không hợp lệ (nơi gọi trả 400). Chỉ nhận đúng dạng chuẩn do `encodeKeysetCursor` sinh: bộ ký tự và độ
// dài theo `shape`, thời gian ISO có mili-giây hợp lệ (ngày 31/02 bị loại nhờ so lại chuỗi), id là UUID chữ thường, và
// chuỗi base64url phải là cách viết chuẩn duy nhất của nội dung đó.
export function decodeKeysetCursor(
  raw: string,
  shape: ZodTypeAny,
): KeysetCursor | null {
  if (!shape.safeParse(raw).success) return null;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = text.indexOf('|');
  if (separator < 0) return null;
  const iso = text.slice(0, separator);
  const id = text.slice(separator + 1);
  if (!ISO_MILLIS.test(iso) || !LOWERCASE_UUID.test(id)) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== iso) return null;
  if (encodeKeysetCursor({ at, id }) !== raw) return null;
  return { at, id };
}
