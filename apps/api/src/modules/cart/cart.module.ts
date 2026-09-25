import { Module } from '@nestjs/common';
import { VoucherModule } from '../voucher/voucher.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [VoucherModule],
  controllers: [CartController],
  providers: [CartService],
})
export class CartModule {}
