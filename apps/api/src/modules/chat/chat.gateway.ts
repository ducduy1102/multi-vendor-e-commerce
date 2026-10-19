import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { chatTypingPayloadSchema, REALTIME_EVENTS } from '@ecommerce/types';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../../shared/realtime/realtime-emitter';
import { REALTIME_GATEWAY_OPTIONS } from '../../shared/realtime/realtime.constants';
import type { RealtimeSocket } from '../../shared/realtime/realtime.types';
import { SocketTypingState } from './chat-typing-state';
import { ChatService } from './chat.service';

// Sự kiện socket của chat (Week10.md 4.7): DUY NHẤT `chat:typing` — client báo "tôi đang gõ", server chuyển cho
// đối phương. Kết nối, xác thực, phòng riêng và ngắt khi hết hạn nằm ở shared/realtime (RealtimeGateway); gateway
// này chỉ ĐỌC `client.data.user` do middleware của nó gán và gửi qua cổng REALTIME_EMITTER, không đụng tới server
// socket.io. Mọi lệnh GHI (gửi tin, đánh dấu đã đọc) vẫn đi qua REST (D2): đây là sự kiện duy nhất client gửi lên.
//
// Các quy tắc an toàn, theo thứ tự xử lý:
//  1. socket chưa xác thực ⇒ bỏ (không thể xảy ra khi middleware đã chạy; đóng kín thay vì tin);
//  2. chặn lụt theo socket, TRƯỚC khi làm bất cứ việc gì tốn kém — kể cả sự kiện sai định dạng cũng tính;
//  3. payload qua Zod, chỉ lấy `conversationId` — client KHÔNG chỉ định được người nhận; sai ⇒ bỏ im lặng;
//  4. tối đa 1 tín hiệu/2 giây/hội thoại/socket;
//  5. kiểm thành viên với DB (ChatService), nhớ kết quả theo socket; người nhận luôn là ĐỐI PHƯƠNG suy ra từ DB;
//  6. không phải thành viên, hội thoại không có, shop không còn hoạt động ⇒ bỏ im lặng (không có ack, không có lỗi
//     — không để dò xem hội thoại có tồn tại không).
// Handler không bao giờ ném (Nest sẽ gửi sự kiện `exception` về client) và không bao giờ log payload.
//
// Tuỳ chọn Socket.io PHẢI giống hệt RealtimeGateway (xem REALTIME_GATEWAY_OPTIONS): Nest chỉ tạo một server cho
// các gateway cùng cổng và lấy tuỳ chọn của gateway nào quét trước.
@WebSocketGateway(REALTIME_GATEWAY_OPTIONS)
export class ChatGateway {
  private readonly logger = new Logger(ChatGateway.name);
  // Trạng thái theo socket; WeakMap nên tự giải phóng khi socket bị thu dọn, không cần móc vào sự kiện ngắt kết nối.
  private readonly states = new WeakMap<object, SocketTypingState>();

  constructor(
    private readonly chat: ChatService,
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
  ) {}

  @SubscribeMessage(REALTIME_EVENTS.chatTyping)
  async handleTyping(
    @ConnectedSocket() client: RealtimeSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    try {
      await this.relayTyping(client, body);
    } catch (error) {
      // Chỉ log thông điệp lỗi — không bao giờ payload, userId hay conversationId.
      this.logger.error(
        `Relaying chat typing failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async relayTyping(
    client: RealtimeSocket,
    body: unknown,
  ): Promise<void> {
    const userId = client.data.user?.userId;
    if (!userId) return;

    const state = this.stateOf(client);
    if (!state.withinFloodLimit()) return;

    const parsed = chatTypingPayloadSchema.safeParse(body);
    if (!parsed.success) return;
    const { conversationId } = parsed.data;
    if (!state.claimSlot(conversationId)) return;

    let known = state.recall(conversationId);
    if (!known) {
      const recipientId = await this.chat.resolveTypingRecipient(
        userId,
        conversationId,
      );
      state.remember(conversationId, recipientId);
      known = { recipientId };
    }
    if (!known.recipientId) return;

    await this.realtime.emitToUser(
      known.recipientId,
      REALTIME_EVENTS.chatTyping,
      {
        conversationId,
      },
    );
  }

  private stateOf(client: RealtimeSocket): SocketTypingState {
    let state = this.states.get(client);
    if (!state) {
      state = new SocketTypingState();
      this.states.set(client, state);
    }
    return state;
  }
}
