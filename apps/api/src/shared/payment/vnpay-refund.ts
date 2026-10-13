import { z } from 'zod';
import { VNPAY_API_VERSION } from './payment-config';
import type { RefundParams, RefundResult } from './payment-gateway.interface';
import {
  buildPipeSignData,
  formatVnpDate,
  isSignatureEqual,
  signVnpay,
  VNPAY_REFUND_REQUEST_SIGN_FIELDS,
  VNPAY_REFUND_RESPONSE_SIGN_FIELDS,
} from './vnpay-signature';

// Phần THUẦN của hoàn tiền VNPay (`vnp_Command=refund`, Week9.md 2.12): dựng request có chữ ký, kiểm chữ ký
// response và phân loại kết quả. Không gọi mạng, không đọc ENV — provider lo phần đó — nên test được bằng
// vector cố định mà không cần cổng thật.

const REFUND_CREATED_BY = 'system';

export const MANUAL_REFUND_HINT =
  'refund it manually on the VNPay merchant portal and record the reference';

// vnp_TransactionType: 02 = hoàn toàn phần, 03 = hoàn một phần.
const FULL_REFUND = '02';
const PARTIAL_REFUND = '03';

// RefundParams đã đủ điều kiện để GỌI cổng: số nhận về từ cổng và mốc thời gian chắc chắn có.
export type RefundableParams = RefundParams & {
  gatewayTransactionId: string;
  gatewayPaidAt: Date;
};

// Kiểm điều kiện để GỌI ĐƯỢC cổng. Thiếu mã giao dịch hoặc mốc thời gian (thanh toán cũ, trước khi lưu
// vnp_PayDate) thì không đoán mà trả lý do — provider đổi thành FAILED xác định để Admin hoàn thủ công.
export function checkRefundParams(
  params: RefundParams,
): { ok: true; params: RefundableParams } | { ok: false; reason: string } {
  const reject = (reason: string) => ({ ok: false as const, reason });
  if (!/^[A-Za-z0-9]{1,32}$/.test(params.refundRef)) {
    return reject('Refund reference is not a valid VNPay request id');
  }
  if (!/^[A-Za-z0-9]{1,100}$/.test(params.txnRef)) {
    return reject(
      'Payment reference is not a valid VNPay transaction reference',
    );
  }
  if (
    !Number.isInteger(params.amountVnd) ||
    !Number.isInteger(params.paymentAmountVnd) ||
    params.amountVnd < 1 ||
    params.amountVnd > params.paymentAmountVnd
  ) {
    return reject('Refund amount is out of range for the payment');
  }
  const { gatewayTransactionId, gatewayPaidAt } = params;
  if (!gatewayTransactionId || !gatewayPaidAt) {
    return reject(
      `This payment has no recorded VNPay transaction number or time (made before automatic refunds were supported); ${MANUAL_REFUND_HINT}`,
    );
  }
  return {
    ok: true,
    params: { ...params, gatewayTransactionId, gatewayPaidAt },
  };
}

export interface BuildRefundRequestInput {
  tmnCode: string;
  hashSecret: string;
  params: RefundableParams;
  now: Date;
  // Địa chỉ IP máy chủ gọi API (vnp_IpAddr).
  serverIp: string;
}

// Body JSON gửi tới API hoàn tiền, kèm vnp_SecureHash. Mọi giá trị là chuỗi.
export function buildRefundRequest(
  input: BuildRefundRequestInput,
): Record<string, string> {
  const { params } = input;
  const fields: Record<string, string> = {
    // Mã yêu cầu ỔN ĐỊNH theo khoản hoàn: gọi lại cùng khoản hoàn thì cổng thấy cùng mã (VNPay đòi mã không
    // trùng trong ngày) — là chốt chống hoàn trùng một phần khi phản hồi bị mất.
    vnp_RequestId: params.refundRef,
    vnp_Version: VNPAY_API_VERSION,
    vnp_Command: 'refund',
    vnp_TmnCode: input.tmnCode,
    vnp_TransactionType:
      params.amountVnd === params.paymentAmountVnd
        ? FULL_REFUND
        : PARTIAL_REFUND,
    vnp_TxnRef: params.txnRef,
    // ×100 chỉ ở biên VNPay, giống lúc tạo thanh toán.
    vnp_Amount: String(params.amountVnd * 100),
    vnp_TransactionNo: params.gatewayTransactionId,
    vnp_TransactionDate: formatVnpDate(params.gatewayPaidAt),
    vnp_CreateBy: REFUND_CREATED_BY,
    vnp_CreateDate: formatVnpDate(input.now),
    vnp_IpAddr: input.serverIp,
    // Tiếng Việt KHÔNG DẤU và không chứa `|` (ký tự nối của chuỗi ký): chuỗi cố định từ mã tham chiếu đã kiểm.
    vnp_OrderInfo: `Hoan tien don hang ${params.txnRef}`,
  };
  const secureHash = signVnpay(
    buildPipeSignData(VNPAY_REFUND_REQUEST_SIGN_FIELDS, fields),
    input.hashSecret,
  );
  return { ...fields, vnp_SecureHash: secureHash };
}

// Số có thể về dạng chuỗi hoặc số tuỳ cổng/ngôn ngữ phía VNPay; luôn quy về chuỗi để ghép chuỗi ký đúng cách
// VNPay ghép. Trường lạ bị bỏ (không `passthrough`).
const looseString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .optional();

const refundResponseSchema = z.object({
  vnp_ResponseId: looseString,
  vnp_Command: looseString,
  vnp_ResponseCode: z.union([z.string(), z.number()]).transform(String),
  vnp_Message: looseString,
  vnp_TmnCode: looseString,
  vnp_TxnRef: looseString,
  vnp_Amount: looseString,
  vnp_BankCode: looseString,
  vnp_PayDate: looseString,
  vnp_TransactionNo: looseString,
  vnp_TransactionType: looseString,
  vnp_TransactionStatus: looseString,
  vnp_OrderInfo: looseString,
  vnp_SecureHash: looseString,
});
export type VnpayRefundResponse = z.infer<typeof refundResponseSchema>;

// Throw khi body không phải đối tượng có vnp_ResponseCode — không hiểu được thì không kết luận gì (provider để
// lỗi nổi lên, RefundService coi là PENDING).
export function parseRefundResponse(body: unknown): VnpayRefundResponse {
  const result = refundResponseSchema.safeParse(body);
  if (!result.success) {
    throw new Error('VNPay refund response could not be understood');
  }
  return result.data;
}

export type ResponseSignature = 'valid' | 'invalid' | 'absent';

export function checkRefundResponseSignature(
  response: VnpayRefundResponse,
  hashSecret: string,
): ResponseSignature {
  const received = response.vnp_SecureHash;
  if (!received) return 'absent';
  const expected = signVnpay(
    buildPipeSignData(VNPAY_REFUND_RESPONSE_SIGN_FIELDS, response),
    hashSecret,
  );
  return isSignatureEqual(received, expected) ? 'valid' : 'invalid';
}

// Mã vnp_ResponseCode mà tài liệu nêu là TỪ CHỐI xác định, yêu cầu chưa được xử lý: sai mã kết nối (02), dữ liệu
// sai định dạng (03), không thấy giao dịch gốc (91), giao dịch gốc không thành công ở VNPay (95), sai chữ ký (97).
// Mã KHÔNG có ở đây — 99 "lỗi khác", mã lạ — là KHÔNG XÁC ĐỊNH ⇒ PENDING: có thể yêu cầu của ta đã được nhận,
// kết luận FAILED nhầm sẽ mở đường hoàn tay lần nữa ⇒ hoàn hai lần.
const DEFINITE_REJECTION_CODES = new Set(['02', '03', '91', '95', '97']);

// Mã 94 có HAI nghĩa trái ngược (đo trên sandbox thật, Week9.md 2.12), chỉ phân biệt được bằng vnp_Message:
//  - "Request is duplicated": VNPay đã thấy vnp_RequestId này ⇒ yêu cầu TRƯỚC của ta đã tới cổng (có thể đã hoàn
//    xong mà phản hồi bị mất) ⇒ KHÔNG XÁC ĐỊNH, phải là PENDING (phản hồi này không có chữ ký);
//  - "Too many refund count (>0)": giao dịch gốc đã hết lượt hoàn (sandbox chỉ cho MỘT lần hoàn mỗi giao dịch) và
//    yêu cầu này chưa được xử lý ⇒ TỪ CHỐI xác định, chờ thử lại cũng vô ích ⇒ FAILED để Admin hoàn tay ngay.
// Message lạ ở mã 94 giữ PENDING (an toàn: thử lại bằng cùng mã yêu cầu rồi hết lượt thì Admin kiểm tra).
const REFUND_COUNT_EXCEEDED_CODE = '94';
const REFUND_COUNT_EXCEEDED_MESSAGE = /too many refund/i;

// vnp_TransactionStatus của giao dịch hoàn khi vnp_ResponseCode = 00 (VNPay đã NHẬN yêu cầu hoàn — message
// sandbox là "Refund success"): 00 hoàn xong; 05 VNPay đang xử lý; 06 đã gửi sang ngân hàng; 09 bị từ chối.
// Sandbox trả 05 cho một lần hoàn thành công, nên 05/06 được coi là cổng ĐÃ NHẬN (SUCCESS) — tiền về tài khoản
// khách theo thời gian của ngân hàng, không thể chờ đồng bộ. Giá trị khác không xác định ⇒ PENDING.
const REFUND_ACCEPTED_STATUSES = new Set(['00', '05', '06']);
const REFUND_STATUS_REJECTED = '09';

function describeRejection(response: VnpayRefundResponse): string {
  const message = (response.vnp_Message ?? '').replace(/\s+/g, ' ').trim();
  const suffix = message ? `: ${message.slice(0, 200)}` : '';
  return `VNPay rejected the refund (code ${response.vnp_ResponseCode})${suffix}`;
}

// Phân loại kết quả. Chữ ký sai ⇒ throw: nội dung không đáng tin nên không kết luận cả hai chiều. Không có chữ
// ký ⇒ không bao giờ SUCCESS (chỉ chữ ký hợp lệ mới đủ để ghi nhận đã trả tiền); từ chối xác định thì vẫn nhận
// vì sai chỉ khiến Admin xử lý tay, không làm mất tiền.
export function interpretRefundResponse(
  response: VnpayRefundResponse,
  signature: ResponseSignature,
): RefundResult {
  if (signature === 'invalid') {
    throw new Error('VNPay refund response has an invalid signature');
  }

  const code = response.vnp_ResponseCode;
  if (code === '00') {
    if (signature !== 'valid') {
      throw new Error('VNPay refund response is not signed');
    }
    const status = response.vnp_TransactionStatus;
    if (status !== undefined && REFUND_ACCEPTED_STATUSES.has(status)) {
      return {
        outcome: 'SUCCESS',
        gatewayRef:
          response.vnp_TransactionNo || response.vnp_ResponseId || null,
        failureReason: null,
      };
    }
    if (status === REFUND_STATUS_REJECTED) {
      return {
        outcome: 'FAILED',
        gatewayRef: null,
        failureReason: `VNPay rejected the refund transaction (status ${status})`,
      };
    }
    return { outcome: 'PENDING', gatewayRef: null, failureReason: null };
  }

  if (
    code === REFUND_COUNT_EXCEEDED_CODE &&
    REFUND_COUNT_EXCEEDED_MESSAGE.test(response.vnp_Message ?? '')
  ) {
    return {
      outcome: 'FAILED',
      gatewayRef: null,
      failureReason: `${describeRejection(response)}; ${MANUAL_REFUND_HINT}`,
    };
  }
  if (DEFINITE_REJECTION_CODES.has(code)) {
    return {
      outcome: 'FAILED',
      gatewayRef: null,
      failureReason: describeRejection(response),
    };
  }
  return { outcome: 'PENDING', gatewayRef: null, failureReason: null };
}
