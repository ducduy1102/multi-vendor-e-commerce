import { z } from 'zod';
import { readPositiveInt } from '../utils/read-positive-int';
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

export function readVnpayAmountLimits(): AmountLimits {
  const min = readPositiveInt('VNPAY_MIN_AMOUNT', DEFAULT_MIN_AMOUNT);
  const max = Math.min(
    readPositiveInt('VNPAY_MAX_AMOUNT', VNPAY_MAX_AMOUNT_HARD_LIMIT),
    VNPAY_MAX_AMOUNT_HARD_LIMIT,
  );
  return { min, max };
}

// COD (Week8.md 1.6) không có cổng nên không cần khoá ENV — chỉ có trần giá trị đơn (rủi ro không
// thu được tiền tăng theo giá trị đơn). Sàn 1 đồng: đơn 0 đồng không có ý nghĩa thanh toán.
const DEFAULT_COD_MAX_AMOUNT = 10_000_000;

export function readCodAmountLimits(): AmountLimits {
  return {
    min: 1,
    max: readPositiveInt('COD_MAX_AMOUNT', DEFAULT_COD_MAX_AMOUNT),
  };
}

// Hạn thanh toán = lúc tạo lần thử + TTL (Week7.md 1.4). Áp dụng chung cho mọi cổng nên đặt ở đây,
// không riêng VNPay. Job hết hạn (quét + nhả giữ chỗ) làm ở 2.10 — đây chỉ là nơi ĐỌC cấu hình.
const DEFAULT_PAYMENT_TTL_MINUTES = 15;

export function readPaymentTtlMinutes(): number {
  return readPositiveInt('PAYMENT_TTL_MINUTES', DEFAULT_PAYMENT_TTL_MINUTES);
}

// Ân hạn trước khi THU HỒI giữ chỗ (Week7.md 1.4): không thu hồi ngay tại expiresAt vì IPN của giao
// dịch trả đúng sát giờ hết hạn có thể tới trễ. Trong [expiresAt, expiresAt + ân hạn) coi là "đã hết
// hạn" (không cho thanh toán lại) nhưng kho/voucher CHƯA bị nhả — dùng ở `reclaimCheckoutGroup`
// (2.10) và hết hạn "lười" (`getCheckoutGroup`/`retryPayment`, 2.9).
const DEFAULT_PAYMENT_RECLAIM_GRACE_MINUTES = 5;

export function readPaymentReclaimGraceMinutes(): number {
  return readPositiveInt(
    'PAYMENT_RECLAIM_GRACE_MINUTES',
    DEFAULT_PAYMENT_RECLAIM_GRACE_MINUTES,
  );
}

// Trần thời gian giữ hàng khi bấm "thanh toán lại" nhiều lần (Week7.md 1.4): lần thử mới có
// `expiresAt = min(now + TTL, checkoutGroup.createdAt + MAX_HOLD)` — không thì retry liên tục giữ
// hàng vô hạn (giữ chỗ để hết hàng của người khác).
const DEFAULT_PAYMENT_MAX_HOLD_MINUTES = 30;

export function readPaymentMaxHoldMinutes(): number {
  return readPositiveInt(
    'PAYMENT_MAX_HOLD_MINUTES',
    DEFAULT_PAYMENT_MAX_HOLD_MINUTES,
  );
}
