import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { OrderModule } from '../order/order.module';
import { ProductModule } from '../product/product.module';
import { VoucherModule } from '../voucher/voucher.module';
import { PaymentModule } from '../../shared/payment/payment.module';
import { AddressController } from './address.controller';
import { AddressService } from './address.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

// Chiều phụ thuộc (Week7.md 1.14): checkout → { cart, voucher, product, order, shared/payment }.
@Module({
  imports: [
    CartModule,
    VoucherModule,
    ProductModule,
    OrderModule,
    PaymentModule,
  ],
  controllers: [CheckoutController, AddressController],
  providers: [CheckoutService, AddressService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
