import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherService } from './voucher.service';

@Module({
  controllers: [VoucherController],
  providers: [VoucherService],
  // CartService gọi VoucherService.validate để dựng discount (Week6.md 1.7),
  // phụ thuộc 1 chiều cart → voucher, VoucherService không được import ngược.
  exports: [VoucherService],
})
export class VoucherModule {}
