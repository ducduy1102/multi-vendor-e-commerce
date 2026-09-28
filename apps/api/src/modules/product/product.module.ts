import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../../shared/cloudinary/cloudinary.module';
import { ProductController } from './product.controller';
import { InventoryService } from './inventory.service';
import { ProductService } from './product.service';

@Module({
  imports: [CloudinaryModule],
  controllers: [ProductController],
  providers: [ProductService, InventoryService],
  // CheckoutService/PaymentService giữ chỗ/chốt/nhả kho qua InventoryService (Week7.md 1.14).
  exports: [InventoryService],
})
export class ProductModule {}
