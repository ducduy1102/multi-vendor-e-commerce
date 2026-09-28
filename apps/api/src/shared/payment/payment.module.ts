import { Module } from '@nestjs/common';
import { MockPaymentProvider } from './mock-payment.provider';
import { PaymentGatewayService } from './payment-gateway.service';
import { VnpayProvider } from './vnpay.provider';

// Hạ tầng cổng thanh toán bên thứ 3, đặt ở shared/ ngay từ module đầu tiên dùng tới
// (rules/general.md mục 1) — đổi/thêm cổng chỉ sửa ở đây. Mọi provider có constructor rẻ, không throw.
@Module({
  providers: [VnpayProvider, MockPaymentProvider, PaymentGatewayService],
  // OrderController (2.9) gọi thẳng VnpayProvider/MockPaymentProvider.verifyCallback ở endpoint
  // IPN/return/mock — mỏng hơn khi đi qua PaymentGatewayService.get() (đã biết chắc cổng theo route).
  exports: [PaymentGatewayService, VnpayProvider, MockPaymentProvider],
})
export class PaymentModule {}
