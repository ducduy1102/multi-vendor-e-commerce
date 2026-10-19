import { Module } from '@nestjs/common';
import { RealtimeModule } from '../../shared/realtime/realtime.module';
import { CHAT_DIRECTORY } from './chat-directory';
import { ChatService } from './chat.service';
import { ConversationController } from './conversation.controller';
import { PrismaChatDirectory } from './prisma-chat-directory';
import { SellerConversationController } from './seller-conversation.controller';

// Module chat (Week10.md Bước 4). Gateway (typing, 4.7) được thêm ở bước sau. Không import module nghiệp vụ nào
// khác: thông tin shop/người dùng đi qua cổng CHAT_DIRECTORY — đổi bản cài đặt ở dòng provider dưới đây là đủ khi
// tách chat thành service riêng. RealtimeModule (hạ tầng dùng chung ở shared/) cấp cổng REALTIME_EMITTER để đẩy
// tin tới người nhận mà không biết gì về Socket.io. Các guard (JwtAuthGuard, EmailVerifiedGuard, ShopOwnerGuard)
// nằm ở shared/ và chỉ cần PrismaService (PrismaModule là global).
@Module({
  imports: [RealtimeModule],
  controllers: [ConversationController, SellerConversationController],
  providers: [
    ChatService,
    { provide: CHAT_DIRECTORY, useClass: PrismaChatDirectory },
  ],
  exports: [ChatService],
})
export class ChatModule {}
