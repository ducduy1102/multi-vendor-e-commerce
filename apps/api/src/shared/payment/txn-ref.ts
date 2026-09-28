import { randomInt } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TXN_REF_LENGTH = 20;

// Mã tham chiếu gửi cổng, duy nhất mỗi lần thử thanh toán (Payment.txnRef @unique). Sinh bằng `crypto`
// (~103 bit), chữ HOA + số: thoả `vnp_TxnRef` của VNPay (chữ-số ≤ 100 ký tự) lẫn regex `orderId` của
// Momo, và KHÔNG nhúng id nội bộ hay thông tin cá nhân (Week7.md 1.9).
export function generateTxnRef(): string {
  let ref = '';
  for (let i = 0; i < TXN_REF_LENGTH; i++) {
    ref += ALPHABET[randomInt(ALPHABET.length)];
  }
  return ref;
}
