import { Module } from '@nestjs/common';
import { RealtimeModule } from '../../shared/realtime/realtime.module';
import { CHAT_DIRECTORY } from './chat-directory';
import { ChatService } from './chat.service';
import { PrismaChatDirectory } from './prisma-chat-directory';

// Module chat (Week10.md Bước 4). Controller (4.6) và gateway (4.7) được thêm ở các bước sau. Không import module
// nghiệp vụ nào khác: thông tin shop/người dùng đi qua cổng CHAT_DIRECTORY — đổi bản cài đặt ở dòng provider
// dưới đây là đủ khi tách chat thành service riêng. RealtimeModule (hạ tầng dùng chung ở shared/) cấp cổng
// REALTIME_EMITTER để đẩy tin tới người nhận mà không biết gì về Socket.io.
@Module({
  imports: [RealtimeModule],
  providers: [
    ChatService,
    { provide: CHAT_DIRECTORY, useClass: PrismaChatDirectory },
  ],
  exports: [ChatService],
})
export class ChatModule {}
