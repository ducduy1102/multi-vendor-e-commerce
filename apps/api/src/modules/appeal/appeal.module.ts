import { Module } from '@nestjs/common';
import { NotificationModule } from '../../shared/notification/notification.module';
import { AppealService } from './appeal.service';
import { ProductAppealController } from './product-appeal.controller';
import { ShopAppealController } from './shop-appeal.controller';

// Phía CHỦ SHOP của kháng nghị (Week11.md 4.6 và 5.8): gửi và xem lịch sử kháng nghị của chính shop, và của từng sản phẩm bị gỡ của shop.
// Phía ADMIN (hàng đợi + quyết định) nằm ở modules/admin vì nó điều phối việc mở khoá shop / khôi phục sản phẩm. `appeal` là module LÁ:
// không import module nghiệp vụ nào (module-boundaries.spec.ts), shop/sản phẩm/trạng thái đọc bằng PrismaService, hạ tầng dùng chung
// (guard, thông báo) ở shared/.
@Module({
  imports: [NotificationModule],
  controllers: [ShopAppealController, ProductAppealController],
  providers: [AppealService],
})
export class AppealModule {}
