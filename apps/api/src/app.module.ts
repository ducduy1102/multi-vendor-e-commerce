import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './shared/prisma/prisma.module';
import { HealthModule } from './shared/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ShopModule } from './modules/shop/shop.module';
import { ProductModule } from './modules/product/product.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { CartModule } from './modules/cart/cart.module';
import { VoucherModule } from './modules/voucher/voucher.module';
import { OrderModule } from './modules/order/order.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { AdminModule } from './modules/admin/admin.module';
import { ReviewModule } from './modules/review/review.module';
import { ChatModule } from './modules/chat/chat.module';
import { RealtimeModule } from './shared/realtime/realtime.module';

@Module({
  imports: [
    // 1 lần duy nhất cho toàn app (Week7.md 1.4/2.10) — kích hoạt @Cron() của PaymentExpiryJob.
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    ShopModule,
    ProductModule,
    WishlistModule,
    CartModule,
    VoucherModule,
    OrderModule,
    CheckoutModule,
    AdminModule,
    ReviewModule,
    ChatModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
