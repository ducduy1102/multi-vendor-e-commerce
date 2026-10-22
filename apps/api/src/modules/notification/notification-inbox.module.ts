import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationInboxService } from './notification-inbox.service';

// Phía ĐỌC của thông báo (Week10.md 7.6): hộp thư của người dùng đăng nhập. Phía GHI là `shared/notification`
// (NotificationModule) — hai phần tách riêng để module nghiệp vụ chỉ cần ghi mà không kéo theo controller, và để sau này
// tách thông báo thành service riêng thì mỗi phía đổi độc lập. Không import module nghiệp vụ nào (module-boundaries.spec.ts):
// bảng `notifications` chỉ có hai bên đọc/ghi là hai module này. JwtAuthGuard ở shared/ chỉ cần PrismaService (PrismaModule
// là global).
@Module({
  controllers: [NotificationController],
  providers: [NotificationInboxService],
})
export class NotificationInboxModule {}
