import { Module } from '@nestjs/common';
import { NotificationModule } from '../../shared/notification/notification.module';
import { ProductModule } from '../product/product.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

// Chiều phụ thuộc (Week9.md 2.0): review → product (chỉ ProductRatingService — điểm ghi duy nhất của
// Product.avgRating/reviewCount). Dữ liệu đơn hàng tự đọc bằng PrismaService, KHÔNG import `order`; chiều
// ngược lại (`product`/`order` → `review`) bị cấm để đồ thị không có vòng (module-boundaries.spec.ts).
@Module({
  imports: [NotificationModule, ProductModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
