import { Module } from '@nestjs/common';
import { OrderModule } from '../order/order.module';
import { ShopModule } from '../shop/shop.module';
import { AdminRefundController } from './admin-refund.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// Khu quản trị toàn sàn. Duyệt shop dùng ShopModule (ShopStatusService); xử lý tiền hoàn (Week9.md 2.9) dùng
// OrderModule (RefundQueryService / RefundRequestActionService / RefundService) — chỉ qua các service đã export.
@Module({
  imports: [ShopModule, OrderModule],
  controllers: [AdminController, AdminRefundController],
  providers: [AdminService],
})
export class AdminModule {}
