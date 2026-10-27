import { z } from 'zod';
import { shopStatusSchema } from './shop';
import { isSafeMessageText } from './text-safety';

// Quản lý người dùng của Admin (Week11.md Bước 3, D2): khoá / cấm / mở lại tài khoản và danh sách người dùng. File này là
// HỢP ĐỒNG dùng chung của BE và FE: bảng chuyển trạng thái, schema body/query, hình dạng response (allowlist) — không
// có logic nghiệp vụ. Thực thi thật (UPDATE có điều kiện, cascade shop, đẩy phiên) nằm ở BE (3.3, 3.4).

// --- Hằng số ----------------------------------------------------------------------------------------

// Độ dài tối đa của lý do. PHẢI khớp cột `users.status_reason VARCHAR(500)` và CHECK
// `users_status_reason_length_in_range` (migration `add_user_status_reason`): `admin-user-schemas.spec.ts` đọc file
// migration và schema.prisma rồi so cận trên, nên lệch là test đỏ. Zod đếm đơn vị UTF-16, Postgres đếm ký tự nên Zod
// luôn chặt hơn hoặc bằng DB.
export const ADMIN_USER_REASON_MAX_LENGTH = 500;
// Độ dài tối đa của từ khoá tìm kiếm (email hoặc tên): đủ cho một địa chỉ email dài nhất thực tế (RFC: 254).
export const ADMIN_USER_SEARCH_MAX_LENGTH = 254;
// Số dòng tối đa mỗi trang, như `/admin/shops`.
export const ADMIN_USER_LIST_MAX_PAGE_SIZE = 50;
// Trần của số trang (100.000 trang × 50 dòng = 5 triệu người dùng, xa hơn mọi quy mô thực tế). Không có trần thì `page=1e21`
// vẫn qua `z.coerce.number().int()` (1e21 là "số nguyên" của JS) rồi `OFFSET 2e22` làm Postgres báo `bigint out of range` ⇒
// 500 thay vì 400 (đã đo trên Postgres thật).
export const ADMIN_USER_LIST_MAX_PAGE = 100_000;

// --- Trạng thái tài khoản ---------------------------------------------------------------------------

// Khớp enum Prisma `AccountStatus` (test parity ở BE). ACTIVE = dùng bình thường; SUSPENDED = tạm khoá (mở lại được);
// BANNED = cấm (mức nặng: mở lại phải xét lại, shop không tự mở); DEACTIVATED = người dùng TỰ xoá tài khoản, không
// thuộc Admin và ngoài phạm vi Tuần 11.
export const accountStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED']);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

// Chỉ có hai vai (D3). Khớp enum Prisma `Role`.
export const userRoleSchema = z.enum(['USER', 'ADMIN']);
export type UserRole = z.infer<typeof userRoleSchema>;

export interface AccountStatusTransition {
  from: AccountStatus;
  to: AccountStatus;
}

// MỘT bảng chuyển trạng thái duy nhất cho các lần đổi `User.accountStatus` do ADMIN thực hiện (D2). Mọi cạnh trong bảng
// đều là cạnh của Admin — người dùng tự đổi trạng thái (DEACTIVATED) không đi qua đây nên không có trong bảng:
//   ACTIVE    → SUSPENDED   tạm khoá                    (bắt buộc lý do)
//   ACTIVE    → BANNED      cấm                         (bắt buộc lý do)
//   SUSPENDED → BANNED      nâng từ tạm khoá lên cấm    (bắt buộc lý do)
//   SUSPENDED → ACTIVE      mở lại                      (shop do chính lần khoá này tự mở lại — 3.4)
//   BANNED    → ACTIVE      mở lại sau khi xét lại      (shop KHÔNG tự mở — 3.4)
// Cố ý KHÔNG có BANNED → SUSPENDED (hạ mức): muốn nhẹ hơn thì mở lại rồi khoá lại, để mỗi lần đổi có đúng một lý do
// và cascade shop không phải suy luận "đang hạ từ cấm xuống khoá thì shop ra sao". Không có cạnh vào hay ra khỏi
// DEACTIVATED, và không có cạnh tự trỏ về chính nó (khoá hai lần ⇒ cạnh không tồn tại ⇒ 409, nên hai Admin bấm cùng lúc
// chỉ một bên thắng).
export const ADMIN_ACCOUNT_STATUS_TRANSITIONS: readonly AccountStatusTransition[] = [
  { from: 'ACTIVE', to: 'SUSPENDED' },
  { from: 'ACTIVE', to: 'BANNED' },
  { from: 'SUSPENDED', to: 'BANNED' },
  { from: 'SUSPENDED', to: 'ACTIVE' },
  { from: 'BANNED', to: 'ACTIVE' },
];

export function canTransitionAccountStatus(from: AccountStatus, to: AccountStatus): boolean {
  return ADMIN_ACCOUNT_STATUS_TRANSITIONS.some((edge) => edge.from === from && edge.to === to);
}

// Các trạng thái Admin được đưa một tài khoản đang ở `from` tới — FE dùng để suy nút (khoá / cấm / mở lại), BE dùng để
// so khớp tập đích của body.
export function accountStatusTargets(from: AccountStatus): AccountStatus[] {
  return ADMIN_ACCOUNT_STATUS_TRANSITIONS.filter((edge) => edge.from === from).map(
    (edge) => edge.to,
  );
}

// Hai đích của `POST /admin/users/:id/suspend`. Mở lại luôn về ACTIVE nên có endpoint và schema riêng (`reactivate`).
export const adminUserSuspendTargetSchema = z.enum(['SUSPENDED', 'BANNED']);
export type AdminUserSuspendTarget = z.infer<typeof adminUserSuspendTargetSchema>;

// --- Request ----------------------------------------------------------------------------------------

// Lý do do Admin nhập (văn bản thuần, có thể nhiều dòng). BẮT BUỘC ở cả khoá lẫn mở lại: lý do đi vào nhật ký quản trị,
// vào cột `status_reason` (chỉ khi khoá) và vào email gửi cho chủ tài khoản. Cùng cách chuẩn hoá của tin nhắn chat:
// `\r\n`/`\r` → `\n`, cắt khoảng trắng hai đầu, rồi kiểm độ dài và ký tự (chặn NUL, điều khiển, bidi-override, BOM, dấu
// phân dòng Unicode). Không chặn `<` `>`: lý do hiển thị nguyên văn như chữ (React tự escape; email phải qua escapeHtml).
// Thông điệp lỗi là KEY i18n (namespace `admin`) như mọi schema dùng chung.
export const adminUserReasonSchema = z
  .string({
    required_error: 'admin.validationReasonRequired',
    invalid_type_error: 'admin.validationReasonRequired',
  })
  .transform((value) => value.replace(/\r\n?/g, '\n'))
  .pipe(
    z
      .string()
      .trim()
      .min(1, 'admin.validationReasonRequired')
      .max(ADMIN_USER_REASON_MAX_LENGTH, 'admin.validationReasonTooLong')
      .refine(isSafeMessageText, 'admin.validationReasonUnsafe'),
  );

// POST /admin/users/:id/suspend — `status` KHÔNG có mặc định: Admin phải chọn rõ tạm khoá hay cấm.
export const suspendUserSchema = z.object({
  status: adminUserSuspendTargetSchema,
  reason: adminUserReasonSchema,
});
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

// POST /admin/users/:id/reactivate — đích luôn là ACTIVE nên body chỉ có lý do.
export const reactivateUserSchema = z.object({ reason: adminUserReasonSchema });
export type ReactivateUserInput = z.infer<typeof reactivateUserSchema>;

// GET /admin/users. Query param qua URL luôn là string — coerce number cho page/limit (rules/backend.md mục 2). `q` tìm theo
// email hoặc tên (BE so khớp không phân biệt hoa-thường và dấu, 3.2); chuỗi rỗng coi như không tìm; NUL và ký tự điều khiển
// bị từ chối vì Postgres không nhận NUL trong tham số văn bản (sẽ thành 500 thay vì 400). Không có `status` mặc định:
// bỏ trống = mọi trạng thái.
export const adminUserListQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(ADMIN_USER_SEARCH_MAX_LENGTH, 'admin.validationSearchTooLong')
    .refine(
      (value) => isSafeMessageText(value) && !value.includes('\n'),
      'admin.validationSearchUnsafe',
    )
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  role: userRoleSchema.optional(),
  status: accountStatusSchema.optional(),
  page: z.coerce.number().int().positive().max(ADMIN_USER_LIST_MAX_PAGE).default(1),
  limit: z.coerce.number().int().positive().max(ADMIN_USER_LIST_MAX_PAGE_SIZE).default(20),
});
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

// --- Response (allowlist) ---------------------------------------------------------------------------

// Một người dùng trong danh sách. ALLOWLIST: chỉ những trường này được rời BE — KHÔNG BAO GIỜ có `passwordHash`,
// `refreshTokenHash`, hay hash của token xác thực email / đặt lại mật khẩu (test khoá tên các trường nhạy cảm). Thêm
// trường mới ở BE mà không thêm vào đây thì FE không thấy (z.object tự bỏ trường lạ khi parse) — chủ đích.
export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
  accountStatus: accountStatusSchema,
  // Lý do và mốc của lần Admin đổi trạng thái GẦN NHẤT; null khi chưa từng bị đổi, và `statusReason` về null khi mở lại
  // (lý do mở lại nằm ở nhật ký quản trị, không ở cột này). Người dùng tự xoá tài khoản không có lý do.
  statusReason: z.string().nullable(),
  statusChangedAt: z.string().nullable(),
  // Chỉ cho biết đã xác thực email hay chưa, không lộ mốc hay token.
  isEmailVerified: z.boolean(),
  createdAt: z.string(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListResponseSchema = z.object({
  items: z.array(adminUserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

// Chi tiết một người dùng (ngăn bên phải ở 3.5): thêm ngôn ngữ email, số đơn, các shop họ sở hữu và lịch sử nhật ký quản
// trị về chính tài khoản này. Ghi chú nội bộ của Admin sẽ thêm ở 4.3 khi nguồn đó có.
export const adminUserShopSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: shopStatusSchema,
});
export type AdminUserShop = z.infer<typeof adminUserShopSchema>;

// Số shop và số dòng lịch sử tối đa trả trong chi tiết. Luật nghiệp vụ là tối đa 1 shop mỗi người (ép ở service, không
// phải ràng buộc DB) nên mức 20 chỉ là chặn trên phòng thủ; lịch sử trả 20 dòng MỚI NHẤT (chưa cần phân trang: một tài
// khoản hiếm khi bị đổi trạng thái quá vài lần).
export const ADMIN_USER_DETAIL_SHOPS_LIMIT = 20;
export const ADMIN_USER_HISTORY_LIMIT = 20;

// Một dòng nhật ký quản trị về người dùng (Week11.md 3.2). ALLOWLIST: không có `ip`/`userAgent` của Admin (dấu vết kiểm
// toán, không phải thứ để hiện ra màn hình). `action` là chuỗi chứ không phải enum để một hành động mà FE chưa biết
// (hoặc đã bị bỏ) không làm hỏng cả trang chi tiết — FE rơi về nhãn chung. `actorName` null khi tài khoản Admin đã bị xoá
// (nhật ký không có khoá ngoại nên dòng vẫn còn). `meta` chỉ chứa id / mã enum / số / cờ theo luật của nhật ký.
export const adminUserHistoryEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  meta: z.record(z.union([z.string(), z.number(), z.boolean()])),
  createdAt: z.string(),
});
export type AdminUserHistoryEntry = z.infer<typeof adminUserHistoryEntrySchema>;

export const adminUserDetailSchema = adminUserSchema.extend({
  locale: z.enum(['vi', 'en']),
  // Số đơn người này đã ĐẶT với tư cách người mua (mọi trạng thái, kể cả đã huỷ).
  orderCount: z.number().int().nonnegative(),
  shops: z.array(adminUserShopSchema),
  history: z.array(adminUserHistoryEntrySchema),
});
export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>;
