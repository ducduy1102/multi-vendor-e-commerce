import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import { isSignatureEqual } from './vnpay-signature';
import type {
  AmountLimits,
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentGateway,
  PaymentOutcome,
  RawCallback,
  VerifiedCallback,
} from './payment-gateway.interface';
import { VNPAY_MAX_AMOUNT_HARD_LIMIT } from './payment-config';

// Cổng GIẢ để kiểm thử tự động và demo (Week7.md 1.9): không cần khoá, không cần mạng, chạy được bằng
// Playwright — thứ VNPay/Momo thật không cho. Đi đúng đường xác nhận thật (verifyCallback →
// confirmPayment). HẠN CHẾ nói rõ: mock KHÔNG kiểm chứng được chữ ký thật của cổng; phần đó chỉ được
// bảo đảm bằng unit test vector cố định và bằng thử VNPay sandbox thật.

// Bị vô hiệu hoá CỨNG ở production dù cờ ENV bật nhầm (kiểm ở cả PaymentGatewayService, createPayment
// và verifyCallback — 3 lớp, không chỉ 1).
export function isMockPaymentEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.PAYMENT_MOCK_ENABLED?.trim().toLowerCase() === 'true'
  );
}

function mockSecret(): string {
  return process.env.PAYMENT_MOCK_SECRET?.trim() || 'dev-only-mock-secret';
}

function apiPublicUrl(): string {
  return (
    process.env.API_PUBLIC_URL?.trim() || 'http://localhost:4000'
  ).replace(/\/+$/, '');
}

const OUTCOMES: readonly PaymentOutcome[] = ['SUCCESS', 'FAILED', 'PENDING'];

const hmac = (payload: string): string =>
  createHmac('sha256', mockSecret()).update(payload, 'utf8').digest('hex');

@Injectable()
export class MockPaymentProvider implements PaymentGateway {
  // Mock thay thế MỌI phương thức khi được bật (PaymentGatewayService quyết định); `method` chỉ để thoả interface.
  readonly method = 'VNPAY' as const;

  isConfigured(): boolean {
    return isMockPaymentEnabled();
  }

  amountLimits(): AmountLimits {
    return { min: 1_000, max: VNPAY_MAX_AMOUNT_HARD_LIMIT };
  }

  // payUrl trỏ tới endpoint mock của BE (làm ở 2.9) cho chọn thành công/thất bại/bỏ qua. Chữ ký
  // `sig` để endpoint đó biết link do BE phát ra, không phải tự gõ tuỳ ý.
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    if (!isMockPaymentEnabled()) {
      return Promise.reject(new Error('Mock payment is disabled'));
    }
    const { txnRef, amountVnd } = params;
    const query = new URLSearchParams({
      txnRef,
      amount: String(amountVnd),
      sig: hmac(`pay|${txnRef}|${amountVnd}`),
    });
    return Promise.resolve({
      payUrl: `${apiPublicUrl()}/api/v1/payments/mock/pay?${query.toString()}`,
    });
  }

  // Dùng bởi endpoint mock: link thanh toán có đúng do BE phát ra không.
  verifyPayLink(txnRef: string, amount: string, sig: string): boolean {
    if (!isMockPaymentEnabled()) return false;
    return isSignatureEqual(sig, hmac(`pay|${txnRef}|${amount}`));
  }

  // Dựng dữ liệu callback có chữ ký cho kết quả người dùng chọn ở trang mock, rồi đi qua verifyCallback.
  buildCallback(
    txnRef: string,
    amountVnd: number,
    outcome: PaymentOutcome,
  ): RawCallback {
    const transactionNo = `MOCK${txnRef.slice(0, 12)}`;
    return {
      txnRef,
      amount: String(amountVnd),
      outcome,
      transactionNo,
      sig: hmac(`cb|${txnRef}|${amountVnd}|${outcome}|${transactionNo}`),
    };
  }

  verifyCallback(raw: RawCallback): VerifiedCallback {
    const invalid: VerifiedCallback = {
      isSignatureValid: false,
      txnRef: null,
      amountVnd: null,
      gatewayTransactionId: null,
      outcome: 'PENDING',
    };
    if (!isMockPaymentEnabled()) return invalid;

    const { txnRef, amount, outcome, transactionNo, sig } = raw;
    if (
      typeof txnRef !== 'string' ||
      typeof amount !== 'string' ||
      typeof outcome !== 'string' ||
      typeof transactionNo !== 'string' ||
      typeof sig !== 'string' ||
      !OUTCOMES.includes(outcome as PaymentOutcome)
    ) {
      return invalid;
    }
    const expected = hmac(`cb|${txnRef}|${amount}|${outcome}|${transactionNo}`);
    if (!isSignatureEqual(sig, expected)) return invalid;

    return {
      isSignatureValid: true,
      txnRef,
      amountVnd: /^\d{1,10}$/.test(amount) ? Number(amount) : null,
      gatewayTransactionId: transactionNo,
      outcome: outcome as PaymentOutcome,
    };
  }
}
