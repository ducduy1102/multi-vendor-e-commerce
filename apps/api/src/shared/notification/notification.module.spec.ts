import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationFactsLoader } from './notification-facts.loader';
import { NotificationModule } from './notification.module';
import { NotificationService } from './notification.service';

// PrismaModule là module toàn cục của ứng dụng thật; ở đây thay bằng bản rỗng để chỉ dựng NotificationModule.
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class FakePrismaModule {}

describe('NotificationModule', () => {
  const compile = () =>
    Test.createTestingModule({
      imports: [FakePrismaModule, NotificationModule],
    }).compile();

  it('khởi tạo được: NotificationService nhận đủ phụ thuộc (Prisma, bộ tải dữ kiện, cổng real-time) mà không cần ENV nào', async () => {
    const saved = {
      secret: process.env.JWT_ACCESS_SECRET,
      cors: process.env.CORS_ORIGIN,
    };
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.CORS_ORIGIN;
    try {
      const moduleRef = await compile();

      expect(moduleRef.get(NotificationService)).toBeInstanceOf(
        NotificationService,
      );
    } finally {
      if (saved.secret !== undefined)
        process.env.JWT_ACCESS_SECRET = saved.secret;
      if (saved.cors !== undefined) process.env.CORS_ORIGIN = saved.cors;
    }
  });

  it('chỉ export NotificationService: module khác không với tới bộ tải dữ kiện', () => {
    const exported = Reflect.getMetadata(
      'exports',
      NotificationModule,
    ) as unknown[];

    expect(exported).toEqual([NotificationService]);
    expect(exported).not.toContain(NotificationFactsLoader);
  });
});
