import { z } from 'zod';
import { LIST_MAX_PAGE } from './pagination';
import { isSafeMessageText } from './text-safety';

// Ghi chú nội bộ của Admin về một người dùng hoặc một shop (Week11.md 4.3, D15): để các Admin kế tiếp biết "vì sao" và "đã
// làm gì" mà không phải đọc lại cả nhật ký. CHỈ THÊM (không sửa, không xoá — cả ở mã lẫn ở DB bằng trigger) và CHỈ Admin
// thấy: không route nào ngoài `/admin/notes` trả ghi chú, kể cả chi tiết người dùng / danh sách shop của Admin. File này là
// HỢP ĐỒNG dùng chung của BE và FE (schema body/query và hình dạng response); thực thi nằm ở `AdminNotesService`.

// --- Hằng số ----------------------------------------------------------------------------------------

// Độ dài tối đa của một ghi chú (ký tự UTF-16). PHẢI khớp CHECK `admin_notes_content_length_in_range` (migration
// `add_admin_notes`): `admin-note-schemas.spec.ts` đọc file migration và so cận trên, nên lệch là test đỏ. Zod đếm đơn vị
// UTF-16 còn `char_length` đếm ký tự ⇒ Zod luôn chặt hơn hoặc bằng DB.
export const ADMIN_NOTE_CONTENT_MAX_LENGTH = 1000;
// Số ghi chú tối đa mỗi trang (mới nhất trước). Một đối tượng hiếm khi có quá vài chục ghi chú nên 50 là trần an toàn.
export const ADMIN_NOTE_LIST_MAX_PAGE_SIZE = 50;

// --- Đối tượng --------------------------------------------------------------------------------------

// Loại đối tượng có thể gắn ghi chú. Khớp enum Prisma `AdminNoteTargetType` (test parity ở BE); thêm loại mới (vd sản phẩm)
// là thêm giá trị enum bằng một migration riêng.
export const ADMIN_NOTE_TARGET_TYPES = ['USER', 'SHOP'] as const;
export const adminNoteTargetTypeSchema = z.enum(ADMIN_NOTE_TARGET_TYPES);
export type AdminNoteTargetType = z.infer<typeof adminNoteTargetTypeSchema>;

// --- Request ----------------------------------------------------------------------------------------

// Nội dung ghi chú: văn bản thuần, có thể nhiều dòng. Cùng cách chuẩn hoá của lý do khoá tài khoản và tin nhắn chat:
// `\r\n`/`\r` → `\n`, cắt khoảng trắng hai đầu, rồi kiểm độ dài và ký tự (chặn NUL, điều khiển, bidi-override, BOM, dấu phân
// dòng Unicode). Không chặn `<` `>`: ghi chú hiển thị nguyên văn như chữ (React tự escape). Thông điệp lỗi là KEY i18n
// (namespace `admin`) như mọi schema dùng chung.
export const adminNoteContentSchema = z
  .string({
    required_error: 'admin.validationNoteRequired',
    invalid_type_error: 'admin.validationNoteRequired',
  })
  .transform((value) => value.replace(/\r\n?/g, '\n'))
  .pipe(
    z
      .string()
      .trim()
      .min(1, 'admin.validationNoteRequired')
      .max(ADMIN_NOTE_CONTENT_MAX_LENGTH, 'admin.validationNoteTooLong')
      .refine(isSafeMessageText, 'admin.validationNoteUnsafe'),
  );

// POST /admin/notes — tác giả KHÔNG nằm trong body: luôn là Admin của phiên (BE lấy từ token), client không đặt được.
export const createAdminNoteSchema = z.object({
  targetType: adminNoteTargetTypeSchema,
  targetId: z.string().uuid(),
  content: adminNoteContentSchema,
});
export type CreateAdminNoteInput = z.infer<typeof createAdminNoteSchema>;

// GET /admin/notes. Query param qua URL luôn là string — coerce number cho page/limit (rules/backend.md mục 2). Bắt buộc
// cả `targetType` lẫn `targetId`: không có API "mọi ghi chú của sàn", chỉ đọc theo từng đối tượng.
export const adminNoteListQuerySchema = z.object({
  targetType: adminNoteTargetTypeSchema,
  targetId: z.string().uuid(),
  page: z.coerce.number().int().positive().max(LIST_MAX_PAGE).default(1),
  limit: z.coerce.number().int().positive().max(ADMIN_NOTE_LIST_MAX_PAGE_SIZE).default(20),
});
export type AdminNoteListQuery = z.infer<typeof adminNoteListQuerySchema>;

// --- Response (allowlist) ---------------------------------------------------------------------------

// Một ghi chú. Tên Admin được tra lúc đọc (không lưu trong bảng ghi chú); `authorName` null khi tài khoản Admin đó không còn.
// KHÔNG có email hay thông tin liên hệ nào của Admin.
export const adminNoteSchema = z.object({
  id: z.string(),
  targetType: adminNoteTargetTypeSchema,
  targetId: z.string(),
  content: z.string(),
  authorId: z.string(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminNote = z.infer<typeof adminNoteSchema>;

export const adminNoteListResponseSchema = z.object({
  items: z.array(adminNoteSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminNoteListResponse = z.infer<typeof adminNoteListResponseSchema>;

// Response của POST /admin/notes: ghi chú vừa tạo (cùng hình dạng một dòng danh sách) để màn quản trị thêm vào đầu danh sách
// mà không phải tải lại.
export const adminNoteCreatedResponseSchema = z.object({ note: adminNoteSchema });
export type AdminNoteCreatedResponse = z.infer<typeof adminNoteCreatedResponseSchema>;
