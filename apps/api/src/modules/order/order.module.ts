import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

// Chiều phụ thuộc (Week7.md 1.14): order → { voucher, product, shared/payment }.
// order KHÔNG được import checkout/cart — checkout gọi OrderService.createOrders(tx, ...).
@Module({
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
