import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller';
import { ShopStatusService } from './shop-status.service';
import { ShopService } from './shop.service';

// ShopStatusService là điểm duy nhất đổi Shop.status — export để module khác (admin) gọi qua service,
// không tự ghi trạng thái (module-boundaries.spec.ts cho phép import *.module/*.service giữa các module).
@Module({
  controllers: [ShopController],
  providers: [ShopService, ShopStatusService],
  exports: [ShopStatusService],
})
export class ShopModule {}
