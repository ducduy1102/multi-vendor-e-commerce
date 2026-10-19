import {
  MESSAGE_MAPPING_METADATA,
  MESSAGE_METADATA,
} from '@nestjs/websockets/constants';

// Liệt kê các handler `@SubscribeMessage` của một lớp gateway: [tên phương thức, tên sự kiện]. Đọc đúng khoá
// metadata mà Nest dùng (import từ chính package, KHÔNG gõ lại chuỗi): gõ sai khoá thì test "gateway không có
// handler nào" vẫn xanh vĩnh viễn dù có handler — đã xảy ra với khoá '__isMessageMapping' (không tồn tại).
export function messageHandlersOf(gateway: object): [string, string][] {
  const prototype = (gateway as { prototype: Record<string, unknown> })
    .prototype;
  return Object.getOwnPropertyNames(prototype).flatMap((name) => {
    const handler = prototype[name];
    if (typeof handler !== 'function') return [];
    if (!Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler)) return [];
    return [[name, Reflect.getMetadata(MESSAGE_METADATA, handler) as string]];
  });
}
