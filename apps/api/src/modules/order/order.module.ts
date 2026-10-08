import { Module } from '@nestjs/common';
import { MailModule } from '../../shared/mail/mail.module';
import { PaymentModule } from '../../shared/payment/payment.module';
import { ProductModule } from '../product/product.module';
import { VoucherModule } from '../voucher/voucher.module';
import { BuyerOrderController } from './buyer-order.controller';
import { OrderActionService } from './order-action.service';
import { OrderAutoCompleteJob } from './order-auto-complete.job';
import { OrderEmailService } from './order-email.service';
import { OrderController } from './order.controller';
import { OrderQueryService } from './order-query.service';
import { OrderStatusService } from './order-status.service';
import { OrderService } from './order.service';
import { PaymentExpiryJob } from './payment-expiry.job';
import { PaymentService } from './payment.service';
import { RefundRequestService } from './refund-request.service';
import { RefundService } from './refund.service';
import { SellerOrderController } from './seller-order.controller';

// Chiều phụ thuộc (Week7.md 1.14): order → { voucher, product, shared/payment }.
// order KHÔNG được import checkout/cart — checkout gọi OrderService.createOrders(tx, ...) và
// PaymentService (confirmPayment/reclaimCheckoutGroup/retryPayment/getCheckoutGroup, 2.9).
// PaymentExpiryJob (2.10) chỉ dùng nội bộ (không export) — ScheduleModule.forRoot() đăng ký 1 lần ở
// AppModule, còn @Cron() tự hoạt động miễn provider có trong graph của app.
@Module({
  imports: [MailModule, PaymentModule, ProductModule, VoucherModule],
  controllers: [OrderController, BuyerOrderController, SellerOrderController],
  providers: [
    OrderService,
    OrderActionService,
    OrderEmailService,
    OrderQueryService,
    OrderStatusService,
    PaymentService,
    RefundRequestService,
    RefundService,
    PaymentExpiryJob,
    OrderAutoCompleteJob,
  ],
  exports: [
    OrderService,
    OrderStatusService,
    OrderEmailService,
    PaymentService,
  ],
})
export class OrderModule {}
