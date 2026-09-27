import { z } from 'zod';
import type { AmountLimits } from './payment-gateway.interface';

// Cấu hình cổng thanh toán đọc từ ENV LÚC DÙNG, không lúc boot (rules/backend.md mục 8): thiếu khoá
// không được làm sập cả app, chỉ làm phương thức đó "chưa cấu hình". ENV optional dùng
// `?.trim() || fallback`, không dùng `??` (rules/general.md mục 4) vì `VAR=` để trống cho chuỗi rỗng.

export const VNPAY_SANDBOX_PAY_URL =
  'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

// vnp_Amount = số tiền × 100, tối đa 12 chữ số ⇒ số tiền tối đa 9.999.999.999 VND (tài liệu VNPay).
export const VNPAY_MAX_AMOUNT_HARD_LIMIT = 9_999_999_999;
// Tài liệu VNPay không nêu sàn/trần cụ thể của từng phương thức → mặc định thận trọng, chỉnh qua ENV.
const DEFAULT_MIN_AMOUNT = 1_000;

const vnpayConfigSchema = z.object({
  tmnCode: z.string().min(1),
  hashSecret: z.string().min(1),
  payUrl: z.string().url(),
});
export type VnpayConfig = z.infer<typeof vnpayConfigSchema>;

function readEnv() {
  return {
    tmnCode: process.env.VNPAY_TMN_CODE?.trim() || '',
    hashSecret: process.env.VNPAY_HASH_SECRET?.trim() || '',
    payUrl: process.env.VNPAY_PAY_URL?.trim() || VNPAY_SANDBOX_PAY_URL,
  };
}

// Không throw: dùng để quyết định phương thức có khả dụng không.
export function isVnpayConfigured(): boolean {
  return vnpayConfigSchema.safeParse(readEnv()).success;
}

// Throw khi thiếu/sai cấu hình — chỉ gọi lúc thật sự tạo thanh toán. Không đưa giá trị khoá vào message.
export function readVnpayConfig(): VnpayConfig {
  const result = vnpayConfigSchema.safeParse(readEnv());
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`VNPay is not configured correctly (${fields})`);
  }
  return result.data;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() || String(fallback);
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

export function readVnpayAmountLimits(): AmountLimits {
  const min = readPositiveInt('VNPAY_MIN_AMOUNT', DEFAULT_MIN_AMOUNT);
  const max = Math.min(
    readPositiveInt('VNPAY_MAX_AMOUNT', VNPAY_MAX_AMOUNT_HARD_LIMIT),
    VNPAY_MAX_AMOUNT_HARD_LIMIT,
  );
  return { min, max };
}

// Hạn thanh toán = lúc tạo lần thử + TTL (Week7.md 1.4). Áp dụng chung cho mọi cổng nên đặt ở đây,
// không riêng VNPay. Job hết hạn (quét + nhả giữ chỗ) làm ở 2.10 — đây chỉ là nơi ĐỌC cấu hình.
const DEFAULT_PAYMENT_TTL_MINUTES = 15;

export function readPaymentTtlMinutes(): number {
  return readPositiveInt('PAYMENT_TTL_MINUTES', DEFAULT_PAYMENT_TTL_MINUTES);
}
