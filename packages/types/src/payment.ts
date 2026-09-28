import { z } from 'zod';

// Khớp enum PaymentMethod/PaymentStatus của Prisma. COD không có (Week7.md 1.9).
export const paymentMethodSchema = z.enum(['VNPAY', 'MOMO']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

// Vì sao 1 phương thức không chọn được — BE quyết định, FE không tự đoán (1.9). Phương thức
// chưa có khoá ENV ⇒ NOT_CONFIGURED; tổng tiền ngoài sàn/trần của phương thức ⇒ lý do số tiền.
export const paymentMethodUnavailableReasonSchema = z.enum([
  'NOT_CONFIGURED',
  'AMOUNT_TOO_SMALL',
  'AMOUNT_TOO_LARGE',
]);
export type PaymentMethodUnavailableReason = z.infer<typeof paymentMethodUnavailableReasonSchema>;

export const paymentMethodAvailabilitySchema = z.object({
  method: paymentMethodSchema,
  available: z.boolean(),
  reason: paymentMethodUnavailableReasonSchema.optional(),
});
export type PaymentMethodAvailability = z.infer<typeof paymentMethodAvailabilitySchema>;
