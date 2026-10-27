import { Module } from '@nestjs/common';
import { MailModule } from '../../shared/mail/mail.module';
import { NotificationModule } from '../../shared/notification/notification.module';
import { OrderModule } from '../order/order.module';
import { ShopModule } from '../shop/shop.module';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminRefundController } from './admin-refund.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// Khu quản trị toàn sàn. Duyệt shop dùng ShopModule (ShopStatusService); xử lý tiền hoàn (Week9.md 2.9) dùng
// OrderModule (RefundQueryService / RefundRequestActionService / RefundService) — chỉ qua các service đã export.
// Trang tổng quan (Week11.md 2.5) gom số việc đang chờ từ shop + hoàn tiền.
@Module({
  imports: [ShopModule, OrderModule, MailModule, NotificationModule],
  controllers: [
    AdminController,
    AdminRefundController,
    AdminOverviewController,
  ],
  providers: [AdminService, AdminOverviewService],
})
export class AdminModule {}
