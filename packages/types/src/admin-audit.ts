import { z } from 'zod';
import { isSafeMessageText, utf8ByteLength } from './text-safety';

// Nhật ký quản trị (Week11.md 2.3, D4): MỘT bảng chung, chỉ thêm, ghi "ai (Admin) làm gì lên đối tượng nào, vì sao, lúc
// nào". BE ghi qua AdminAuditService CÙNG transaction với thay đổi nghiệp vụ (khác thông báo: nhật ký phải khớp dữ liệu,
// không thể "đã đổi mà không có dấu vết"). Không có API công khai; Admin xem lịch sử theo đối tượng ở màn quản trị.
// Schema dưới đây là hợp đồng kiểm ở BIÊN ghi: mục sai hình dạng bị từ chối (ném lỗi) chứ không lưu rác.

// --- Hằng số ----------------------------------------------------------------------------------------

// Lý do tối đa (ký tự UTF-16). PHẢI khớp CHECK `admin_audit_logs_reason_length_in_range` ở DB (migration
// `add_admin_audit_logs`): `admin-audit-schemas.spec.ts` đọc file migration và so cận trên, nên lệch là test đỏ. Zod
// đếm đơn vị UTF-16, `char_length` đếm ký tự ⇒ Zod luôn chặt hơn hoặc bằng DB.
export const ADMIN_AUDIT_REASON_MAX_LENGTH = 500;
// `meta` tối đa tính bằng BYTE UTF-8 của JSON gọn. DB giữ lưới an toàn nới gấp đôi (CHECK
// `admin_audit_logs_meta_size_limit` = 2048 byte văn bản jsonb, vì jsonb::text chèn thêm dấu cách) — cùng cách
// `notifications.data`, để "Zod cho qua mà CHECK từ chối" không bao giờ xảy ra.
export const ADMIN_AUDIT_META_MAX_BYTES = 1024;
// Số khoá tối đa của `meta`: nhật ký chỉ cần vài con số/id, không phải kho dữ liệu.
export const ADMIN_AUDIT_META_MAX_KEYS = 12;
// IPv6 dạng chữ dài nhất (kể cả IPv4 ánh xạ, vd `0000:0000:0000:0000:0000:ffff:255.255.255.255`) là 45 ký tự. Khớp CHECK
// `admin_audit_logs_ip_length_in_range`.
export const ADMIN_AUDIT_IP_MAX_LENGTH = 45;
// User-Agent do client tự khai nên chỉ là dấu vết tham khảo: cắt ở 256 ký tự (đủ cho mọi trình duyệt thật). Khớp CHECK
// `admin_audit_logs_user_agent_length_in_range`.
export const ADMIN_AUDIT_USER_AGENT_MAX_LENGTH = 256;

// --- Đối tượng và hành động -------------------------------------------------------------------------

// Loại đối tượng bị tác động. `targetType` là chuỗi ở DB (không phải enum Postgres) nên thêm loại mới không cần
// migration — nhưng PHẢI thêm vào đây; CHECK ở DB chỉ chặn dạng (IN_HOA_GẠCH_DƯỚI) và độ dài.
export const ADMIN_AUDIT_TARGET_TYPES = [
  'USER',
  'SHOP',
  'PRODUCT',
  'REVIEW',
  'CONVERSATION',
  'REPORT',
  'APPEAL',
] as const;
export const adminAuditTargetTypeSchema = z.enum(ADMIN_AUDIT_TARGET_TYPES);
export type AdminAuditTargetType = z.infer<typeof adminAuditTargetTypeSchema>;

// Danh sách ĐÓNG các hành động và loại đối tượng mà mỗi hành động tác động lên — nơi DUY NHẤT khai báo. Mỗi hành động
// được nối vào luồng nghiệp vụ ở bước tương ứng của Week11.md (khoá/mở user 3.3, hủy hàng loạt 4.1, ẩn/hiện đánh giá 5.5,
// xử lý báo cáo 5.4, gỡ/khôi phục sản phẩm 5.7, kháng nghị 5.8, đọc chat 6.1); thêm hành động mới = thêm một dòng ở
// đây (không cần migration). Gắn cứng cặp (hành động → loại đối tượng) để không ghi nhầm kiểu "đọc chat" lên một shop.
export const ADMIN_AUDIT_ACTION_TARGETS = {
  SUSPEND_USER: 'USER',
  REACTIVATE_USER: 'USER',
  CANCEL_SHOP_OPEN_ORDERS: 'SHOP',
  HIDE_REVIEW: 'REVIEW',
  UNHIDE_REVIEW: 'REVIEW',
  RESOLVE_REPORT: 'REPORT',
  CHAT_ACCESSED: 'CONVERSATION',
  TAKE_DOWN_PRODUCT: 'PRODUCT',
  RESTORE_PRODUCT: 'PRODUCT',
  DECIDE_APPEAL: 'APPEAL',
} as const satisfies Record<string, AdminAuditTargetType>;

export type AdminAuditAction = keyof typeof ADMIN_AUDIT_ACTION_TARGETS;
export const ADMIN_AUDIT_ACTIONS = Object.keys(ADMIN_AUDIT_ACTION_TARGETS) as [
  AdminAuditAction,
  ...AdminAuditAction[],
];
export const adminAuditActionSchema = z.enum(ADMIN_AUDIT_ACTIONS);

// --- Lý do và meta ----------------------------------------------------------------------------------

// Lý do do Admin nhập (văn bản thuần, có thể nhiều dòng). Cùng cách chuẩn hoá của tin nhắn chat: `\r\n`/`\r` → `\n`,
// cắt khoảng trắng hai đầu, rồi kiểm độ dài và ký tự (chặn NUL, điều khiển, bidi-override, BOM, dấu phân dòng Unicode).
// Không chặn `<` `>`: lý do được lưu và hiển thị nguyên văn như chữ (React tự escape).
export const adminAuditReasonSchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n'))
  .pipe(z.string().trim().min(1).max(ADMIN_AUDIT_REASON_MAX_LENGTH).refine(isSafeMessageText));

const META_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
// Giá trị của `meta` CHỈ là thứ không thể mang chữ tự do: id (UUID), mã dạng enum (`SUSPENDED`), số đếm (số nguyên
// không âm) hoặc cờ true/false. Không chuỗi tự do ⇒ không có đường nào nhét email/SĐT/nội dung tin nhắn vào nhật ký;
// chữ do người nhập (lý do) có chỗ riêng và đã được kiểm ở trên.
const META_ENUM_CODE = /^[A-Z][A-Z0-9_]{0,39}$/;
const metaValueSchema = z.union([
  z.string().uuid(),
  z.string().regex(META_ENUM_CODE),
  z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  z.boolean(),
]);

export const adminAuditMetaSchema = z
  .record(z.string().regex(META_KEY), metaValueSchema)
  .refine((meta) => Object.keys(meta).length <= ADMIN_AUDIT_META_MAX_KEYS)
  .refine((meta) => utf8ByteLength(JSON.stringify(meta)) <= ADMIN_AUDIT_META_MAX_BYTES);
export type AdminAuditMeta = z.infer<typeof adminAuditMetaSchema>;

// --- Nguồn của request ------------------------------------------------------------------------------

// "Từ đâu" của hành động (OWASP Logging Cheat Sheet: who/what/when/WHERE). Cả hai tuỳ chọn: hành động không xuất phát từ
// request HTTP thì để trống. IP phải là địa chỉ IPv4/IPv6 hợp lệ; User-Agent là MỘT dòng chữ an toàn (không điều khiển,
// bidi-override, xuống dòng). Nơi gọi đưa request qua `auditRequestContext` (apps/api, shared/audit) để chuẩn hoá và cắt gọn
// TRƯỚC khi vào đây — schema này chỉ từ chối giá trị sai, không sửa.
export const adminAuditIpSchema = z.string().max(ADMIN_AUDIT_IP_MAX_LENGTH).ip();
export const adminAuditUserAgentSchema = z
  .string()
  .min(1)
  .max(ADMIN_AUDIT_USER_AGENT_MAX_LENGTH)
  .refine((value) => isSafeMessageText(value) && !value.includes('\n'));

// --- Mục nhật ký ------------------------------------------------------------------------------------

// Mục nhật ký MỘT lần ghi. `.strict()`: khoá lạ bị từ chối (không ai nhét thêm cột), và cặp (hành động, loại đối tượng)
// phải khớp bảng ở trên. `reason` không truyền/null ⇒ NULL ở DB (chuỗi rỗng hay toàn khoảng trắng thì bị TỪ CHỐI, không
// lặng lẽ biến thành NULL); `meta` mặc định là object rỗng.
export const adminAuditEntrySchema = z
  .object({
    actorId: z.string().uuid(),
    action: adminAuditActionSchema,
    targetType: adminAuditTargetTypeSchema,
    targetId: z.string().uuid(),
    reason: adminAuditReasonSchema.nullish(),
    meta: adminAuditMetaSchema.optional(),
    ip: adminAuditIpSchema.nullish(),
    userAgent: adminAuditUserAgentSchema.nullish(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (ADMIN_AUDIT_ACTION_TARGETS[entry.action] !== entry.targetType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetType'],
        message: `action ${entry.action} must target ${ADMIN_AUDIT_ACTION_TARGETS[entry.action]}`,
      });
    }
  });

// Đầu vào của `AdminAuditService.record` (trước khi chuẩn hoá lý do / gán meta mặc định).
export type AdminAuditEntryInput = z.input<typeof adminAuditEntrySchema>;
