import { Module } from '@nestjs/common';
import { ShopModule } from '../shop/shop.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ShopModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
