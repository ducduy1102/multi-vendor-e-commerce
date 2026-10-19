import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeGateway } from './realtime.gateway';
import {
  JwtSocketAuthenticator,
  SOCKET_AUTHENTICATOR,
} from './socket-authenticator';

// Hạ tầng real-time dùng chung (Week10.md 3.2) — đặt ở shared/ theo ngoại lệ "provider bên thứ 3/hạ tầng" của
// rules/general.md mục 1, không phải nghiệp vụ của riêng module nào. Chưa export gì: cổng phát sự kiện cho
// các module nghiệp vụ được thêm ở bước 3.3.
@Module({
  // JwtService để verify access token; secret truyền lúc gọi (cùng cách với AuthModule), không đặt mặc định.
  imports: [JwtModule.register({})],
  providers: [
    RealtimeAccessService,
    RealtimeGateway,
    { provide: SOCKET_AUTHENTICATOR, useClass: JwtSocketAuthenticator },
  ],
  exports: [RealtimeAccessService],
})
export class RealtimeModule {}
