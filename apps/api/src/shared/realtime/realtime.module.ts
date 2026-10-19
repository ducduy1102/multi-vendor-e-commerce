import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeAccessService } from './realtime-access.service';
import { REALTIME_EMITTER } from './realtime-emitter';
import { RealtimeGateway } from './realtime.gateway';
import {
  JwtSocketAuthenticator,
  SOCKET_AUTHENTICATOR,
} from './socket-authenticator';

// Hạ tầng real-time dùng chung (Week10.md 3.2) — đặt ở shared/ theo ngoại lệ "provider bên thứ 3/hạ tầng" của
// rules/general.md mục 1, không phải nghiệp vụ của riêng module nào. Chỉ export REALTIME_EMITTER: module
// nghiệp vụ import RealtimeModule rồi `@Inject(REALTIME_EMITTER)` giao diện RealtimeEmitter, không bao giờ
// biết tới gateway hay socket.io.
@Module({
  // JwtService để verify access token; secret truyền lúc gọi (cùng cách với AuthModule), không đặt mặc định.
  imports: [JwtModule.register({})],
  providers: [
    RealtimeAccessService,
    RealtimeGateway,
    { provide: SOCKET_AUTHENTICATOR, useClass: JwtSocketAuthenticator },
    // Bản thật của cổng phát sự kiện chính là gateway (nó nắm server Socket.io). Tách microservice sau này chỉ
    // cần đổi dòng này sang một bản gọi từ xa.
    { provide: REALTIME_EMITTER, useExisting: RealtimeGateway },
  ],
  exports: [REALTIME_EMITTER],
})
export class RealtimeModule {}
