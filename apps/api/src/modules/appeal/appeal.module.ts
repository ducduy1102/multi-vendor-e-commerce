import { Module } from '@nestjs/common';
import { NotificationModule } from '../../shared/notification/notification.module';
import { AppealService } from './appeal.service';
import { ShopAppealController } from './shop-appeal.controller';

// Phía CHỦ SHOP của kháng nghị (Week11.md 4.6): gửi và xem lịch sử kháng nghị của chính shop. Phía ADMIN (hàng đợi + quyết định)
// nằm ở modules/admin vì nó điều phối việc mở khoá shop. `appeal` là module LÁ: không import module nghiệp vụ nào
// (module-boundaries.spec.ts), shop/trạng thái đọc bằng PrismaService, hạ tầng dùng chung (guard, thông báo) ở shared/.
@Module({
  imports: [NotificationModule],
  controllers: [ShopAppealController],
  providers: [AppealService],
})
export class AppealModule {}
