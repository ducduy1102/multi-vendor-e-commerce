import type { PaymentMethod } from '@ecommerce/types';

// Giao diện chung cho mọi cổng thanh toán (Week7.md 1.9). Phần khác nhau của từng cổng (tên tham số,
// chữ ký, đơn vị tiền ×100 của VNPay, IPN là GET hay POST) nằm gọn trong provider; PaymentService
// (module order) chỉ làm việc với kết quả đã chuẩn hoá nên logic idempotent/chốt kho viết 1 lần.
// Số tiền trong hệ thống luôn là SỐ NGUYÊN VND — đổi đơn vị chỉ ở biên provider.

export interface CreatePaymentParams {
  // Mã tham chiếu duy nhất cho MỖI LẦN THỬ (Payment.txnRef), xem generateTxnRef().
  txnRef: string;
  amountVnd: number;
  // URL BE mà trình duyệt được cổng đưa về sau khi thanh toán.
  returnUrl: string;
  expiresAt: Date;
  // IP khách; thiếu/không hợp lệ thì provider dùng 127.0.0.1.
  clientIp?: string;
  locale: 'vi' | 'en';
}

export interface CreatePaymentResult {
  payUrl: string;
}

// SUCCESS/FAILED chỉ khi cổng báo XÁC ĐỊNH; mọi mã lạ/chưa hoàn tất là PENDING ("thà chờ hơn là kết
// luận sai" — đánh dấu nhầm FAILED mở đường thanh toán lại, có thể trả tiền 2 lần, Week7.md 1.10).
export type PaymentOutcome = 'SUCCESS' | 'FAILED' | 'PENDING';

export interface VerifiedCallback {
  // false ⇒ mọi field còn lại là null/PENDING và KHÔNG được tin. Chữ ký sai/thiếu/độ dài lạ chỉ ra
  // kết quả này, không bao giờ ném lỗi (endpoint callback phải trả mã "sai chữ ký" cho cổng).
  isSignatureValid: boolean;
  txnRef: string | null;
  // Số tiền cổng báo, đã đổi về VND; null nếu thiếu/không hợp lệ. Người gọi phải so với Payment.amount.
  amountVnd: number | null;
  gatewayTransactionId: string | null;
  outcome: PaymentOutcome;
}

// Dữ liệu thô nhận từ cổng (query của IPN/return VNPay, body IPN Momo...). Giá trị không đảm bảo là chuỗi.
export type RawCallback = Record<string, unknown>;

export interface AmountLimits {
  min: number;
  max: number;
}

// --- Hoàn tiền (Week9.md 1.5/1.6) ----------------------------------------------------------------
// Giống PaymentOutcome nhưng cho hoàn tiền: SUCCESS/FAILED chỉ khi cổng báo XÁC ĐỊNH; mọi tín hiệu mơ hồ
// (quá hạn chờ, mã lạ, cổng chưa trả lời) là PENDING — RefundService để khoản hoàn ở PENDING và job quét
// lại bằng CÙNG refundRef, nên "thà chờ hơn kết luận sai" (kết luận FAILED nhầm mở đường hoàn thủ công
// lần nữa ⇒ hoàn hai lần).
export type RefundOutcome = 'SUCCESS' | 'FAILED' | 'PENDING';

export interface RefundParams {
  // Mã tham chiếu hoàn ỔN ĐỊNH, suy từ PaymentRefund.id (không sinh mới mỗi lần gọi): gọi lại với cùng mã
  // thì cổng PHẢI coi là cùng một yêu cầu và không hoàn thêm lần nữa — nền tảng để RefundJob thử lại an toàn.
  refundRef: string;
  // Khoản thanh toán gốc cần hoàn tiền: mã tham chiếu ta gửi cổng (Payment.txnRef) và mã giao dịch cổng
  // trả về (Payment.transactionId, vd vnp_TransactionNo; null nếu cổng chưa từng báo).
  txnRef: string;
  gatewayTransactionId: string | null;
  // Số tiền hoàn và tổng số tiền của khoản thanh toán gốc (VND nguyên). Cổng phân biệt hoàn toàn bộ với
  // hoàn một phần bằng cặp số này; hoàn quá số đã thanh toán bị từ chối.
  amountVnd: number;
  paymentAmountVnd: number;
  // Lý do hoàn (không chứa dữ liệu nhạy cảm) — gửi kèm cho cổng nếu cổng có chỗ ghi.
  reason: string;
}

export interface RefundResult {
  outcome: RefundOutcome;
  // Mã hoàn do cổng trả về (lưu PaymentRefund.gatewayRef); null khi chưa có (FAILED/PENDING).
  gatewayRef: string | null;
  // Lý do thất bại cho Admin/log (PaymentRefund.failureReason) — KHÔNG hiện cho người mua, không chứa
  // khoá/chữ ký; null khi SUCCESS/PENDING.
  failureReason: string | null;
}

export interface PaymentGateway {
  readonly method: PaymentMethod;
  // Đủ cấu hình ENV để dùng chưa. KHÔNG throw — dùng để quyết định hiện/ẩn phương thức.
  isConfigured(): boolean;
  // Sàn/trần số tiền của phương thức (VND).
  amountLimits(): AmountLimits;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  verifyCallback(raw: RawCallback): VerifiedCallback;
  // Hoàn tiền về nguồn thanh toán ban đầu. Kết quả nghiệp vụ (cổng từ chối, số tiền sai) trả về qua
  // RefundResult chứ không ném lỗi; lỗi bất ngờ (mạng, cấu hình) có thể reject — RefundService bắt và coi
  // là PENDING vì chưa biết cổng đã nhận yêu cầu hay chưa. COD không có cổng nên không đi đường này.
  refund(params: RefundParams): Promise<RefundResult>;
}
