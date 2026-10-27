import {
  ADMIN_AUDIT_USER_AGENT_MAX_LENGTH,
  adminAuditIpSchema,
  clipOptionalNotificationLabel,
  type AdminAuditEntryInput,
} from '@ecommerce/types';
import type { Request } from 'express';

// IP và User-Agent của một request Admin, đã chuẩn hoá để đưa thẳng vào `AdminAuditService.record`:
//   record(tx, { actorId, action, targetType, targetId, ...auditRequestContext(req) })
export type AuditRequestContext = Pick<
  AdminAuditEntryInput,
  'ip' | 'userAgent'
>;

// Express trả IPv4 qua socket IPv6 dưới dạng `::ffff:203.0.113.7`; lưu dạng IPv4 cho dễ đọc và dễ so khớp.
const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

// KHÔNG BAO GIỜ ném: thiếu nguồn request chỉ làm hai trường này để trống, không được làm hỏng hành động quản trị (chính
// dòng nhật ký vẫn ghi đủ ai/làm gì/lên ai).
//  - `req.ip` đúng ngữ nghĩa `trust proxy` của Express (main.ts đặt theo ENV TRUST_PROXY) nên CHỈ đáng tin khi TRUST_PROXY
//    khớp số chặng proxy thật; sai thì mọi dòng nhật ký mang IP của proxy. Không tự đọc `X-Forwarded-For` ở đây (client giả
//    mạo được nếu không qua cơ chế tin cậy của Express).
//  - User-Agent do client tự khai: gộp khoảng trắng, bỏ ký tự điều khiển/giả mạo thứ tự chữ, cắt về 256 ký tự — dùng lại
//    bộ làm sạch nhãn một dòng của thông báo (cùng yêu cầu: văn bản người ngoài đưa vào, hiển thị cho Admin).
export function auditRequestContext(
  req: Pick<Request, 'ip' | 'headers'>,
): AuditRequestContext {
  const context: AuditRequestContext = {};

  const rawIp = req.ip?.trim().replace(IPV4_MAPPED_IPV6, '$1');
  if (rawIp && adminAuditIpSchema.safeParse(rawIp).success) {
    context.ip = rawIp;
  }

  // Node chỉ giữ giá trị đầu của header `user-agent` trùng lặp nên luôn là chuỗi (không bao giờ mảng).
  const userAgent = clipOptionalNotificationLabel(
    req.headers['user-agent'],
    ADMIN_AUDIT_USER_AGENT_MAX_LENGTH,
  );
  if (userAgent) context.userAgent = userAgent;

  return context;
}
