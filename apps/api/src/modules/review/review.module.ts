import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../../shared/audit/admin-audit.module';
import { NotificationModule } from '../../shared/notification/notification.module';
import { ProductModule } from '../product/product.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

// Chiều phụ thuộc (Week9.md 2.0): review → product (chỉ ProductRatingService — điểm ghi duy nhất của
// Product.avgRating/reviewCount). Dữ liệu đơn hàng tự đọc bằng PrismaService, KHÔNG import `order`; chiều
// ngược lại (`product`/`order` → `review`) bị cấm để đồ thị không có vòng (module-boundaries.spec.ts).
@Module({
  imports: [NotificationModule, ProductModule, AdminAuditModule],
  controllers: [ReviewController],
  providers: [ReviewService],
  // Khu Admin (modules/admin) ẩn/hiện đánh giá qua service này — cả khi xử lý báo cáo lẫn route trực tiếp (Week11.md 5.5).
  exports: [ReviewService],
})
export class ReviewModule {}
