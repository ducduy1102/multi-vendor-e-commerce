import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './shared/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ShopModule } from './modules/shop/shop.module';
import { ProductModule } from './modules/product/product.module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { CartModule } from './modules/cart/cart.module';
import { VoucherModule } from './modules/voucher/voucher.module';
import { OrderModule } from './modules/order/order.module';
import { CheckoutModule } from './modules/checkout/checkout.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ShopModule,
    ProductModule,
    WishlistModule,
    CartModule,
    VoucherModule,
    OrderModule,
    CheckoutModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
