import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

// Chiều phụ thuộc (Week7.md 1.14): checkout → { cart, voucher, product, order }.
// Các module còn lại được thêm vào imports khi service tương ứng được export (2.1b, 2.3, 2.7).
@Module({
  imports: [OrderModule],
  controllers: [CheckoutController, AddressController],
  providers: [CheckoutService, AddressService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
