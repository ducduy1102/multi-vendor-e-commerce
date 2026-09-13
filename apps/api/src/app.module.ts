import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './shared/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ShopModule } from './modules/shop/shop.module';

@Module({
  imports: [PrismaModule, AuthModule, ShopModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
