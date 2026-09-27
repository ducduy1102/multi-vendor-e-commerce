import type { ConfirmPaymentOutcome } from './payment.service';

export interface VnpayIpnResponse {
  RspCode: string;
  Message: string;
}

// Ánh xạ kết quả confirmPayment → phản hồi IPN của VNPay (Week7.md 1.10). Mọi kết quả ĐÃ GHI NHẬN
// (kể cả không xác định) trả 00 để VNPay dừng thử lại — CHỈ lỗi bất ngờ phía ta (chưa ghi được gì)
// mới trả 99 để VNPay tự thử lại (idempotent nên an toàn).
export function mapOutcomeToVnpayIpnResponse(
  outcome: ConfirmPaymentOutcome,
): VnpayIpnResponse {
  switch (outcome) {
    case 'CONFIRMED':
    case 'FAILED_RECORDED':
    case 'LATE_SUCCESS_RECORDED':
    case 'DUPLICATE_SUCCESS_RECORDED':
    case 'UNRECOGNIZED':
      return { RspCode: '00', Message: 'Confirm Success' };
    case 'ALREADY_CONFIRMED':
      return { RspCode: '02', Message: 'Order already confirmed' };
    case 'NOT_FOUND':
      return { RspCode: '01', Message: 'Order not found' };
    case 'AMOUNT_MISMATCH':
      return { RspCode: '04', Message: 'Invalid amount' };
    case 'INVALID_SIGNATURE':
      return { RspCode: '97', Message: 'Invalid signature' };
  }
}

// Lỗi bất ngờ phía ta (DB tạm thời lỗi, timeout...) TRƯỚC khi kịp ghi nhận gì — KHÔNG được trả 00.
export const VNPAY_UNEXPECTED_ERROR_RESPONSE: VnpayIpnResponse = {
  RspCode: '99',
  Message: 'Unknow error',
};
