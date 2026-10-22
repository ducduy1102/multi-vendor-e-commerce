import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationFactsLoader } from './notification-facts.loader';
import { NotificationService } from './notification.service';

// Bên ghi thông báo dùng chung (Week10.md 7.3) — đặt ở shared/ vì nhiều module nghiệp vụ (order, checkout, review, shop,
// admin) cùng phát sự kiện, và nó không thuộc nghiệp vụ riêng của module nào (rules/general.md mục 1). Module nghiệp vụ
// import NotificationModule rồi inject NotificationService. Chỉ export service: bộ tải dữ kiện là chi tiết bên trong.
@Module({
  imports: [RealtimeModule],
  providers: [NotificationService, NotificationFactsLoader],
  exports: [NotificationService],
})
export class NotificationModule {}
