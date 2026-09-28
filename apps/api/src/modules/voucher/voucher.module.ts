import { Module } from '@nestjs/common';
import { VoucherController } from './voucher.controller';
import { VoucherUsageService } from './voucher-usage.service';
import { VoucherService } from './voucher.service';

@Module({
  controllers: [VoucherController],
  // VoucherService.validate() dùng VoucherUsageService.countActiveByUser cho perUserLimit (2.8) —
  // cùng module nên tự inject, không phải phụ thuộc chéo.
  providers: [VoucherService, VoucherUsageService],
  // CartService gọi VoucherService.validate để dựng discount (Week6.md 1.7),
  // phụ thuộc 1 chiều cart → voucher, VoucherService không được import ngược.
  exports: [VoucherService, VoucherUsageService],
})
export class VoucherModule {}
