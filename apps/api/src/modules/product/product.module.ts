import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { ProductController } from './product.controller';
import { InventoryService } from './inventory.service';
import { ProductRatingService } from './product-rating.service';
import { ProductService } from './product.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [ProductController],
  providers: [ProductService, InventoryService, ProductRatingService],
  // CheckoutService/PaymentService giữ chỗ/chốt/nhả kho qua InventoryService (Week7.md 1.14);
  // ReviewService ghi điểm đánh giá của sản phẩm qua ProductRatingService (Week9.md 1.8, 2.10).
  exports: [InventoryService, ProductRatingService],
})
export class ProductModule {}
