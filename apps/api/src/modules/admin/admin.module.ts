import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../../shared/audit/admin-audit.module';
import { MailModule } from '../../shared/mail/mail.module';
import { NotificationModule } from '../../shared/notification/notification.module';
import { RealtimeModule } from '../../shared/realtime/realtime.module';
import { OrderModule } from '../order/order.module';
import { ProductModule } from '../product/product.module';
import { ReviewModule } from '../review/review.module';
import { ShopModule } from '../shop/shop.module';
import { AdminAppealsController } from './admin-appeals.controller';
import { AdminAppealsService } from './admin-appeals.service';
import { AdminNotesController } from './admin-notes.controller';
import { AdminNotesService } from './admin-notes.service';
import { AdminOverviewController } from './admin-overview.controller';
import { AdminOverviewService } from './admin-overview.service';
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';
import { AdminRefundController } from './admin-refund.controller';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';
import { AdminReviewsController } from './admin-reviews.controller';
import { AdminReviewsService } from './admin-reviews.service';
import { AdminShopOrdersService } from './admin-shop-orders.service';
import { AdminUserShopCascadeService } from './admin-user-shop-cascade.service';
import { AdminUserStatusService } from './admin-user-status.service';
import { AdminUserController } from './admin-user.controller';
import { AdminUserService } from './admin-user.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

// Khu quản trị toàn sàn. Duyệt shop dùng ShopModule (ShopStatusService); xử lý tiền hoàn (Week9.md 2.9) dùng
// OrderModule (RefundQueryService / RefundRequestActionService / RefundService) — chỉ qua các service đã export.
// Ẩn/hiện đánh giá (Week11.md 5.5) gọi ReviewService (qua ReviewModule) — cả route trực tiếp lẫn hành động HIDE_REVIEW khi xử lý báo cáo.
// Gỡ/khôi phục sản phẩm vi phạm (Week11.md 5.7) gọi ProductModerationService (qua ProductModule) — cả route trực tiếp lẫn hành động
// TAKE_DOWN_PRODUCT khi xử lý báo cáo.
// Hàng đợi và xử lý báo cáo vi phạm (Week11.md 5.4) điều phối ở đây: khoá shop qua AdminService, khoá tài khoản qua AdminUserStatusService,
// cùng transaction với việc đóng báo cáo. Hủy hàng loạt đơn chưa giao của shop bị khoá (4.1) lặp RefundService.cancelOrderWithRefund với actor ADMIN. Trang tổng quan (Week11.md 2.5) gom số việc đang chờ từ shop + hoàn tiền. Quản lý người dùng (Week11.md Bước 3) đọc
// thẳng bảng users / shops / admin_audit_logs của chính nó; khoá / mở tài khoản (3.3) ghi nhật ký quản trị
// (AdminAuditModule), ngắt socket của người bị khoá (RealtimeModule) và gửi email báo chủ tài khoản (MailModule).
@Module({
  imports: [
    ShopModule,
    OrderModule,
    ProductModule,
    ReviewModule,
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
    AdminReportsController,
    AdminReviewsController,
    AdminProductsController,
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
    AdminReportsService,
    AdminReviewsService,
    AdminProductsService,
  ],
})
export class AdminModule {}
