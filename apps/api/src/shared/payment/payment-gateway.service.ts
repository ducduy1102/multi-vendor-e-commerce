import { Injectable } from '@nestjs/common';
import {
  paymentMethodSchema,
  type PaymentMethod,
  type PaymentMethodAvailability,
} from '@ecommerce/types';
import {
  isMockPaymentEnabled,
  MockPaymentProvider,
} from './mock-payment.provider';
import type { PaymentGateway } from './payment-gateway.interface';
import { readCodAmountLimits } from './payment-config';
import { VnpayProvider } from './vnpay.provider';

// Chọn cổng theo PaymentMethod và cho biết phương thức nào khả dụng — BE quyết định, FE không tự đoán
// (Week7.md 1.9). MoMo chưa có provider (làm cuối, không chặn nghiệm thu Tuần 7): trả "chưa cấu hình".
@Injectable()
export class PaymentGatewayService {
  constructor(
    private readonly vnpay: VnpayProvider,
    private readonly mock: MockPaymentProvider,
  ) {}

  // Mock bật (chỉ ngoài production) thì thay MỌI phương thức; ngược lại theo provider thật.
  // Kiểm NODE_ENV ở đây là lớp thứ nhất trong 3 lớp chặn mock ở production.
  get(method: PaymentMethod): PaymentGateway | null {
    if (method === 'COD') return null; // COD không có cổng, kể cả khi mock bật
    if (isMockPaymentEnabled()) return this.mock;
    return method === 'VNPAY' ? this.vnpay : null;
  }

  // Cổng đã cấu hình mới dùng được; trả null nếu phương thức không khả dụng.
  getConfigured(method: PaymentMethod): PaymentGateway | null {
    const gateway = this.get(method);
    return gateway?.isConfigured() ? gateway : null;
  }

  // Khả dụng theo cấu hình ENV + sàn/trần số tiền của phương thức. Dùng ở xem trước (paymentMethods)
  // và kiểm lại ở placeOrder trước khi giữ chỗ tồn kho — để cổng không từ chối SAU khi đã giữ chỗ.
  getAvailability(amountVnd: number): PaymentMethodAvailability[] {
    return paymentMethodSchema.options.map((method) =>
      this.availabilityOf(method, amountVnd),
    );
  }

  availabilityOf(
    method: PaymentMethod,
    amountVnd: number,
  ): PaymentMethodAvailability {
    // COD không có cổng thanh toán nên không phụ thuộc cấu hình ENV hay mock — chỉ có trần giá trị
    // đơn (Week8.md 1.6). Xử lý TRƯỚC khi hỏi cổng: get() trả mock cho MỌI phương thức khi mock bật.
    if (method === 'COD') {
      const { min, max } = readCodAmountLimits();
      if (amountVnd < min) {
        return { method, available: false, reason: 'AMOUNT_TOO_SMALL' };
      }
      if (amountVnd > max) {
        return { method, available: false, reason: 'AMOUNT_TOO_LARGE' };
      }
      return { method, available: true };
    }
    const gateway = this.getConfigured(method);
    if (!gateway) {
      return { method, available: false, reason: 'NOT_CONFIGURED' };
    }
    const { min, max } = gateway.amountLimits();
    if (amountVnd < min) {
      return { method, available: false, reason: 'AMOUNT_TOO_SMALL' };
    }
    if (amountVnd > max) {
      return { method, available: false, reason: 'AMOUNT_TOO_LARGE' };
    }
    return { method, available: true };
  }
}
