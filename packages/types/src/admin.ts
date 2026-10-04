import { z } from 'zod';
import { shopSchema, shopStatusSchema } from './shop';

// --- Duyệt / từ chối / khoá / mở khoá shop (Week8.md 1.8) --------------------------------------------

export const ADMIN_SHOP_REASON_MAX_LENGTH = 500;

// Trạng thái ĐÍCH Admin được đặt — không cạnh ADMIN nào của SHOP_STATUS_TRANSITIONS dẫn về PENDING
// (cạnh REJECTED → PENDING thuộc về OWNER) nên PENDING không phải đích hợp lệ cho Admin (loại ở mức
// kiểu, 400 ngay ở validate thay vì đợi tới service). Test parity: tập này đúng bằng tập đích ADMIN
// của bảng chuyển trạng thái.
export const adminShopTargetStatusSchema = z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']);
export type AdminShopTargetStatus = z.infer<typeof adminShopTargetStatusSchema>;

// Đích cần có lý do: từ chối và khoá. Duyệt/mở khoá luôn xoá lý do (statusReason về null) nên lý do
// gửi kèm khi APPROVED bị bỏ qua, không phải lỗi.
export const ADMIN_SHOP_STATUSES_REQUIRING_REASON: readonly AdminShopTargetStatus[] = [
  'REJECTED',
  'SUSPENDED',
];

// PATCH /admin/shops/:id/status. `reason` là input HTML có thể là "" — coi như chưa nhập (cùng cách
// `shop.ts`: `.transform()` ở CUỐI chain, không dùng z.preprocess để giữ input type cho zodResolver).
export const adminUpdateShopStatusSchema = z
  .object({
    status: adminShopTargetStatusSchema,
    reason: z
      .string()
      .trim()
      .max(ADMIN_SHOP_REASON_MAX_LENGTH, 'admin.validationReasonTooLong')
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
  })
  .superRefine((value, ctx) => {
    if (ADMIN_SHOP_STATUSES_REQUIRING_REASON.includes(value.status) && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'admin.validationReasonRequired',
      });
    }
  });
export type AdminUpdateShopStatusInput = z.infer<typeof adminUpdateShopStatusSchema>;

// GET /admin/shops — mặc định hàng chờ duyệt (PENDING). Query param qua URL luôn là string — coerce
// number cho page/limit (rules/backend.md mục 2).
export const adminShopListQuerySchema = z.object({
  status: shopStatusSchema.default('PENDING'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type AdminShopListQuery = z.infer<typeof adminShopListQuerySchema>;

// Shop kèm thông tin chủ shop để Admin biết liên hệ ai khi duyệt/khoá (route chỉ ADMIN gọi được).
//
// `lastRejectionReason` / `resubmissionCount` (Week8.md 3C) giúp Admin xét lại shop được nộp lại ngay trên
// dòng danh sách: lý do từ chối lần gần nhất (`note` của dòng history `→ REJECTED` mới nhất, null nếu chưa
// từng bị từ chối) và số lần chủ shop đã bấm "gửi duyệt lại" (số dòng history `REJECTED → PENDING`).
// Cả hai SUY TỪ ShopStatusHistory, không phải cột DB.
export const adminShopSchema = shopSchema.extend({
  owner: z.object({
    name: z.string(),
    email: z.string(),
  }),
  lastRejectionReason: z.string().nullable(),
  resubmissionCount: z.number().int().nonnegative(),
});
export type AdminShop = z.infer<typeof adminShopSchema>;

export const adminShopListResponseSchema = z.object({
  items: z.array(adminShopSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminShopListResponse = z.infer<typeof adminShopListResponseSchema>;
