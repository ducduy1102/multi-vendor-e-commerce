import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SOCKET_AUTHENTICATOR } from './socket-authenticator';
import { REALTIME_EMITTER, type RealtimeEmitter } from './realtime-emitter';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeModule } from './realtime.module';

// PrismaModule là module toàn cục của ứng dụng thật; ở đây thay bằng bản rỗng để chỉ dựng RealtimeModule.
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: {} }],
  exports: [PrismaService],
})
class FakePrismaModule {}

describe('RealtimeModule', () => {
  function compile() {
    return Test.createTestingModule({
      imports: [FakePrismaModule, RealtimeModule],
    }).compile();
  }

  it('khởi tạo được mà không cần ENV nào (constructor rẻ, không throw — rules/backend.md mục 8)', async () => {
    const saved = {
      secret: process.env.JWT_ACCESS_SECRET,
      cors: process.env.CORS_ORIGIN,
    };
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.CORS_ORIGIN;
    try {
      await expect(compile()).resolves.toBeDefined();
    } finally {
      if (saved.secret !== undefined)
        process.env.JWT_ACCESS_SECRET = saved.secret;
      if (saved.cors !== undefined) process.env.CORS_ORIGIN = saved.cors;
    }
  });

  it('REALTIME_EMITTER chính là gateway: các module nghiệp vụ gọi qua giao diện, cùng một instance giữ server', async () => {
    const moduleRef = await compile();

    const emitter = moduleRef.get<RealtimeEmitter>(REALTIME_EMITTER);

    expect(emitter).toBe(moduleRef.get(RealtimeGateway));
    expect(typeof emitter.emitToUser).toBe('function');
    expect(typeof emitter.disconnectUser).toBe('function');
  });

  it('cổng xác thực socket được cấp qua token (thay được khi tách service)', async () => {
    const moduleRef = await compile();

    expect(moduleRef.get(SOCKET_AUTHENTICATOR)).toBeDefined();
  });

  it('chỉ export REALTIME_EMITTER: module khác không với tới gateway hay bộ kiểm Origin/IP', () => {
    const exported = Reflect.getMetadata(
      'exports',
      RealtimeModule,
    ) as unknown[];

    expect(exported).toEqual([REALTIME_EMITTER]);
  });
});
