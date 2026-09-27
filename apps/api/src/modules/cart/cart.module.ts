import { Module } from '@nestjs/common';
import { VoucherModule } from '../voucher/voucher.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [VoucherModule],
  controllers: [CartController],
  providers: [CartService],
  // checkout đọc giỏ (getCartItems/buildCartView) khi đặt hàng (Week7.md 1.14).
  exports: [CartService],
})
export class CartModule {}
