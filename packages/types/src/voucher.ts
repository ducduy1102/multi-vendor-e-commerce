import { z } from 'zod';

export const voucherTypeSchema = z.enum(['PERCENT', 'FIXED']);
export type VoucherType = z.infer<typeof voucherTypeSchema>;

// Mã do Seller tự đặt, BE chuẩn hoá về chữ HOA trước khi lưu/tra (Week6.md
// 2.4) — nhận cả chữ thường ở đây để người dùng gõ sao cũng được.
const voucherCodeSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_-]{3,32}$/,
    'Mã chỉ gồm chữ, số, gạch ngang/gạch dưới, dài 3-32 ký tự',
  );

// POST /shops/:shopId/vouchers (Week6.md 2.5). shopId lấy từ route đã qua
// ShopOwnerGuard, KHÔNG nhận từ body. Tiền là số nguyên đồng.
export const createVoucherSchema = z
  .object({
    code: voucherCodeSchema,
    type: voucherTypeSchema,
    value: z.number().positive('Giá trị giảm phải lớn hơn 0'),
    minOrderAmount: z.number().nonnegative().optional(),
    // Chỉ có nghĩa với PERCENT (trần số tiền giảm), xem refine bên dưới.
    maxDiscountAmount: z.number().positive().optional(),
    usageLimit: z.number().int().min(1).optional(),
    perUserLimit: z.number().int().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'PERCENT' && data.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Phần trăm giảm tối đa là 100',
      });
    }
    if (data.type === 'FIXED' && !Number.isInteger(data.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Số tiền giảm phải là số nguyên đồng',
      });
    }
    if (data.type === 'FIXED' && data.maxDiscountAmount !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxDiscountAmount'],
        message: 'Mức giảm tối đa chỉ dùng cho voucher giảm theo phần trăm',
      });
    }
  });
export type CreateVoucherInput = z.infer<typeof createVoucherSchema>;

// PATCH /shops/:shopId/vouchers/:voucherId — bật/tắt tường minh (idempotent),
// không phải "đảo trạng thái".
export const setVoucherActiveSchema = z.object({
  isActive: z.boolean(),
});
export type SetVoucherActiveInput = z.infer<typeof setVoucherActiveSchema>;

// Prisma Decimal serialize ra chuỗi; Date ra chuỗi ISO.
export const voucherSchema = z.object({
  id: z.string(),
  shopId: z.string().nullable(),
  code: z.string(),
  type: voucherTypeSchema,
  value: z.string(),
  minOrderAmount: z.string().nullable(),
  maxDiscountAmount: z.string().nullable(),
  usageLimit: z.number().int().nullable(),
  perUserLimit: z.number().int().nullable(),
  usedCount: z.number().int(),
  isActive: z.boolean(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Voucher = z.infer<typeof voucherSchema>;

export const voucherListResponseSchema = z.object({
  items: z.array(voucherSchema),
});
export type VoucherListResponse = z.infer<typeof voucherListResponseSchema>;
