import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../../shared/audit/admin-audit.module';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { NotificationModule } from '../../shared/notification/notification.module';
import { ProductController } from './product.controller';
import { ProductImageCleanupService } from './product-image-cleanup.service';
import { InventoryService } from './inventory.service';
import { ProductModerationService } from './product-moderation.service';
import { ProductRatingService } from './product-rating.service';
import { ProductService } from './product.service';

@Module({
  imports: [CloudinaryModule, AdminAuditModule, NotificationModule],
  controllers: [ProductController],
  providers: [
    ProductService,
    ProductImageCleanupService,
    InventoryService,
    ProductRatingService,
    ProductModerationService,
  ],
  // CheckoutService/PaymentService giữ chỗ/chốt/nhả kho qua InventoryService (Week7.md 1.14);
  // ReviewService ghi điểm đánh giá của sản phẩm qua ProductRatingService (Week9.md 1.8, 2.10);
  // khu Admin gỡ / khôi phục sản phẩm vi phạm qua ProductModerationService — cả route trực tiếp lẫn hành động TAKE_DOWN_PRODUCT khi
  // xử lý báo cáo (Week11.md 5.7).
  exports: [InventoryService, ProductRatingService, ProductModerationService],
})
export class ProductModule {}
