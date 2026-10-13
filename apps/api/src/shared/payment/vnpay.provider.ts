import { Injectable } from '@nestjs/common';
import type {
  AmountLimits,
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentGateway,
  PaymentOutcome,
  RawCallback,
  RefundParams,
  RefundResult,
  VerifiedCallback,
} from './payment-gateway.interface';
import {
  isVnpayConfigured,
  readVnpayAmountLimits,
  readVnpayConfig,
  readVnpayRefundUrl,
  VNPAY_API_VERSION,
} from './payment-config';
import {
  buildRefundRequest,
  checkRefundParams,
  checkRefundResponseSignature,
  interpretRefundResponse,
  MANUAL_REFUND_HINT,
  parseRefundResponse,
} from './vnpay-refund';
import {
  buildSignData,
  formatVnpDate,
  isSignatureEqual,
  parseVnpDate,
  signVnpay,
} from './vnpay-signature';

const MAX_RETURN_URL_LENGTH = 255; // vnp_ReturnUrl: Alphanumeric[10,255]
const MIN_RETURN_URL_LENGTH = 10;
const DEFAULT_CLIENT_IP = '127.0.0.1';
// Chặn cứng cho cuộc gọi HTTP hoàn tiền. RefundService đã tự đặt hạn riêng (REFUND_GATEWAY_TIMEOUT_MS, mặc định
// 8 giây) và bỏ cuộc trước; hạn này chỉ để kết nối treo không sống mãi sau đó.
const REFUND_HTTP_TIMEOUT_MS = 15_000;

// Mã vnp_ResponseCode mà tài liệu VNPay nêu là THẤT BẠI xác định (khách huỷ, hết hạn chờ, sai OTP,
// không đủ số dư, vượt hạn mức, ngân hàng bảo trì...). Mã KHÔNG có ở đây (kể cả 07 "trừ tiền, nghi ngờ
// gian lận" và 99 "lỗi khác") là KHÔNG XÁC ĐỊNH ⇒ PENDING: chưa biết tiền có bị trừ hay không.
const DEFINITE_FAILURE_RESPONSE_CODES = new Set([
  '09',
  '10',
  '11',
  '12',
  '13',
  '24',
  '51',
  '65',
  '75',
  '79',
]);

// Constructor RẺ và không thể throw (rules/backend.md mục 8): NestJS khởi tạo mọi provider lúc boot
// dù không được gọi; cấu hình chỉ đọc + validate lúc dùng.
@Injectable()
export class VnpayProvider implements PaymentGateway {
  readonly method = 'VNPAY' as const;

  isConfigured(): boolean {
    return isVnpayConfigured();
  }

  amountLimits(): AmountLimits {
    return readVnpayAmountLimits();
  }

  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    // Bọc trong Promise để lỗi đồng bộ (thiếu cấu hình...) thành rejection, cùng hình dạng với Momo (gọi HTTP).
    return Promise.resolve().then(() => this.buildPayment(params));
  }

  private buildPayment(params: CreatePaymentParams): CreatePaymentResult {
    const config = readVnpayConfig();
    const { min, max } = readVnpayAmountLimits();
    const { amountVnd, txnRef, returnUrl } = params;

    if (!Number.isInteger(amountVnd) || amountVnd < min || amountVnd > max) {
      throw new RangeError(`VNPay amount ${amountVnd} is out of range`);
    }
    if (
      returnUrl.length < MIN_RETURN_URL_LENGTH ||
      returnUrl.length > MAX_RETURN_URL_LENGTH
    ) {
      throw new RangeError('VNPay return URL length is out of range');
    }
    if (!/^[A-Za-z0-9]{1,100}$/.test(txnRef)) {
      throw new RangeError(
        'VNPay txnRef must be alphanumeric, up to 100 chars',
      );
    }

    const vnpParams: Record<string, string> = {
      vnp_Version: VNPAY_API_VERSION,
      vnp_Command: 'pay',
      vnp_TmnCode: config.tmnCode,
      // ×100 chỉ ở biên VNPay; đã kiểm ≤ 12 chữ số qua VNPAY_MAX_AMOUNT_HARD_LIMIT.
      vnp_Amount: String(amountVnd * 100),
      vnp_CreateDate: formatVnpDate(new Date()),
      vnp_CurrCode: 'VND',
      vnp_IpAddr: normalizeClientIp(params.clientIp),
      vnp_Locale: params.locale === 'en' ? 'en' : 'vn',
      // Tiếng Việt KHÔNG DẤU, không ký tự đặc biệt: chuỗi cố định, không lấy tên shop/sản phẩm/người mua.
      vnp_OrderInfo: `Thanh toan don hang ${txnRef}`,
      vnp_OrderType: 'other',
      vnp_ReturnUrl: returnUrl,
      vnp_ExpireDate: formatVnpDate(params.expiresAt),
      vnp_TxnRef: txnRef,
    };

    const signData = buildSignData(vnpParams);
    const secureHash = signVnpay(signData, config.hashSecret);
    return {
      payUrl: `${config.payUrl}?${signData}&vnp_SecureHash=${secureHash}`,
    };
  }

  // Hoàn tiền qua API `vnp_Command=refund` (Week9.md 2.12). Kết quả NGHIỆP VỤ của cổng (từ chối, thiếu điều kiện để
  // gọi) trả về qua RefundResult — những ca này luôn kèm hướng dẫn hoàn thủ công; lỗi BẤT NGỜ (mạng, quá hạn, HTTP
  // lỗi, body/chữ ký response không hiểu hoặc sai) ném ra: RefundService coi là PENDING vì chưa biết cổng đã nhận
  // yêu cầu hay chưa, và chạy lại bằng CÙNG refundRef (vnp_RequestId). Message lỗi không chứa khoá hay chữ ký.
  async refund(params: RefundParams): Promise<RefundResult> {
    if (!isVnpayConfigured()) {
      return failedBeforeCall(`VNPay is not configured; ${MANUAL_REFUND_HINT}`);
    }
    const checked = checkRefundParams(params);
    if (!checked.ok) return failedBeforeCall(checked.reason);

    const config = readVnpayConfig();
    const request = buildRefundRequest({
      tmnCode: config.tmnCode,
      hashSecret: config.hashSecret,
      params: checked.params,
      now: new Date(),
      serverIp: DEFAULT_CLIENT_IP,
    });
    const response = parseRefundResponse(
      await postRefundRequest(readVnpayRefundUrl(), request),
    );
    return interpretRefundResponse(
      response,
      checkRefundResponseSignature(response, config.hashSecret),
    );
  }

  // Kiểm chữ ký TRƯỚC mọi thứ khác. Không bao giờ ném lỗi: chữ ký sai/thiếu/dài-ngắn bất thường/giá trị
  // không phải chuỗi đều trả isSignatureValid=false để endpoint callback trả mã "sai chữ ký" cho cổng.
  verifyCallback(raw: RawCallback): VerifiedCallback {
    const invalid: VerifiedCallback = {
      isSignatureValid: false,
      txnRef: null,
      amountVnd: null,
      gatewayTransactionId: null,
      gatewayPaidAt: null,
      outcome: 'PENDING',
    };
    if (!isVnpayConfigured()) return invalid;
    const { hashSecret } = readVnpayConfig();

    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!key.startsWith('vnp_')) continue;
      // Query lặp key (?a=1&a=2) ra mảng, `a[x]=1` ra object: mơ hồ về việc VNPay đã ký gì ⇒ từ chối.
      if (typeof value !== 'string') return invalid;
      params[key] = value;
    }

    const receivedHash = params.vnp_SecureHash;
    delete params.vnp_SecureHash;
    delete params.vnp_SecureHashType;
    if (!receivedHash) return invalid;

    const expected = signVnpay(buildSignData(params), hashSecret);
    if (!isSignatureEqual(receivedHash, expected)) return invalid;

    return {
      isSignatureValid: true,
      txnRef: params.vnp_TxnRef || null,
      amountVnd: parseAmountVnd(params.vnp_Amount),
      gatewayTransactionId: params.vnp_TransactionNo || null,
      // vnp_PayDate chỉ có (và chỉ đáng tin) sau khi chữ ký đã khớp ở trên; sai định dạng ⇒ null.
      gatewayPaidAt: parseVnpDate(params.vnp_PayDate),
      outcome: resolveOutcome(
        params.vnp_ResponseCode,
        params.vnp_TransactionStatus,
      ),
    };
  }
}

// Thất bại XÁC ĐỊNH và chưa gọi cổng — Admin đi đường "ghi nhận đã hoàn thủ công".
function failedBeforeCall(failureReason: string): RefundResult {
  return { outcome: 'FAILED', gatewayRef: null, failureReason };
}

// Gọi API hoàn tiền (POST JSON). Chỉ trả về body đã đọc được; mọi thứ khác (mạng, quá hạn, HTTP không phải 2xx,
// không phải JSON) ném lỗi để người gọi coi là PENDING. Message cố ý chỉ nêu trạng thái HTTP, không kèm URL hay
// body (body request chứa chữ ký).
async function postRefundRequest(
  url: string,
  body: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REFUND_HTTP_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`VNPay refund API answered HTTP ${response.status}`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error('VNPay refund API returned a body that is not JSON');
  }
}

// vnp_Amount là VND × 100 dạng chuỗi số; không phải số nguyên chia hết cho 100 ⇒ null (người gọi coi
// như số tiền không khớp).
function parseAmountVnd(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null;
  const value = Number(raw);
  return value % 100 === 0 ? value / 100 : null;
}

// Thành công CHỈ khi cả vnp_ResponseCode và vnp_TransactionStatus đều "00" (tài liệu VNPay).
// Thất bại xác định cần mã trong danh sách VÀ TransactionStatus khác "00" (tránh tin 1 tín hiệu mâu thuẫn).
function resolveOutcome(
  responseCode: string | undefined,
  transactionStatus: string | undefined,
): PaymentOutcome {
  if (responseCode === '00' && transactionStatus === '00') return 'SUCCESS';
  if (
    responseCode !== undefined &&
    DEFINITE_FAILURE_RESPONSE_CODES.has(responseCode) &&
    transactionStatus !== '00'
  ) {
    return 'FAILED';
  }
  return 'PENDING';
}

// vnp_IpAddr: Alphanumeric[7,45]. Sau proxy phải bật trust proxy thì req.ip mới là IP khách (Tuần 13).
function normalizeClientIp(ip: string | undefined): string {
  const cleaned = (ip ?? '').trim().replace(/^::ffff:/i, '');
  if (cleaned === '::1') return DEFAULT_CLIENT_IP;
  return /^[0-9A-Fa-f:.]{7,45}$/.test(cleaned) ? cleaned : DEFAULT_CLIENT_IP;
}
