import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../../shared/audit/admin-audit.module';
import { MailModule } from '../../shared/mail/mail.module';
import { NotificationModule } from '../../shared/notification/notification.module';
import { RealtimeModule } from '../../shared/realtime/realtime.module';
import { OrderModule } from '../order/order.module';
import { ShopModule } from '../shop/shop.module';
import { AdminAppealsController } from './admin-appeals.controller';
import { AdminAppealsService } from './admin-appeals.service';
import { AdminNotesController } from './admin-notes.controller';
import { AdminNotesService } from './admin-notes.service';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminRefundController } from './admin-refund.controller';
import { AdminShopOrdersService } from './admin-shop-orders.service';
import { AdminUserShopCascadeService } from './admin-user-shop-cascade.service';
import { AdminUserStatusService } from './admin-user-status.service';
import { AdminUserController } from './admin-user.controller';
import { AdminUserService } from './admin-user.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// Khu quản trị toàn sàn. Duyệt shop dùng ShopModule (ShopStatusService); xử lý tiền hoàn (Week9.md 2.9) dùng
// OrderModule (RefundQueryService / RefundRequestActionService / RefundService) — chỉ qua các service đã export.
// Hủy hàng loạt đơn chưa giao của shop bị khoá (4.1) lặp RefundService.cancelOrderWithRefund với actor ADMIN. Trang tổng quan (Week11.md 2.5) gom số việc đang chờ từ shop + hoàn tiền. Quản lý người dùng (Week11.md Bước 3) đọc
// thẳng bảng users / shops / admin_audit_logs của chính nó; khoá / mở tài khoản (3.3) ghi nhật ký quản trị
// (AdminAuditModule), ngắt socket của người bị khoá (RealtimeModule) và gửi email báo chủ tài khoản (MailModule).
@Module({
  imports: [
    ShopModule,
    OrderModule,
    MailModule,
    NotificationModule,
    AdminAuditModule,
    RealtimeModule,
  ],
  controllers: [
    AdminController,
    AdminRefundController,
    AdminOverviewController,
    AdminUserController,
    AdminNotesController,
    AdminAppealsController,
  ],
  providers: [
    AdminService,
    AdminOverviewService,
    AdminUserService,
    AdminUserStatusService,
    AdminUserShopCascadeService,
    AdminShopOrdersService,
    AdminNotesService,
    AdminAppealsService,
  ],
})
export class AdminModule {}
