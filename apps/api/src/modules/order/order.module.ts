import { Module } from '@nestjs/common';
import { PaymentModule } from '../../shared/payment/payment.module';
import { ProductModule } from '../product/product.module';
import { VoucherModule } from '../voucher/voucher.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { PaymentService } from './payment.service';

// Chiều phụ thuộc (Week7.md 1.14): order → { voucher, product, shared/payment }.
// order KHÔNG được import checkout/cart — checkout gọi OrderService.createOrders(tx, ...) và
// PaymentService (confirmPayment/reclaimCheckoutGroup/retryPayment/getCheckoutGroup, 2.9).
@Module({
  imports: [PaymentModule, ProductModule, VoucherModule],
  controllers: [OrderController],
  providers: [OrderService, PaymentService],
  exports: [OrderService, PaymentService],
})
export class OrderModule {}
