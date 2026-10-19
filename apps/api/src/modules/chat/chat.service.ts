import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShopStatus } from '@prisma/client';
import {
  chatMessageContentSchema,
  REALTIME_EVENTS,
  type ChatMessage,
  type ChatMessageEvent,
  type ChatRole,
  type ConversationSummary,
  type SendMessageInput,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  REALTIME_EMITTER,
  type RealtimeEmitter,
} from '../../shared/realtime/realtime-emitter';
import {
  CHAT_MAX_UNANSWERED_MESSAGES,
  CHAT_NEW_CONVERSATIONS_LIMIT,
  CHAT_NEW_CONVERSATIONS_WINDOW_MS,
  CHAT_SEND_RATE_LIMIT,
  CHAT_SEND_RATE_WINDOW_MS,
} from './chat-config';
import {
  CHAT_DIRECTORY,
  type ChatDirectory,
  type ChatShopInfo,
} from './chat-directory';
import { toPreview } from './chat-preview';

// Chỉ những cột dùng để dựng ConversationSummary — không kéo cả hàng.
const CONVERSATION_SELECT = {
  id: true,
  buyerId: true,
  shopId: true,
  buyerLastReadAt: true,
  lastMessageAt: true,
} satisfies Prisma.ConversationSelect;
type ConversationRow = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  createdAt: true,
  clientMessageId: true,
} satisfies Prisma.MessageSelect;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

// Ai đang gọi và dưới tư cách gì — do ROUTE quyết định (đường dẫn của người mua hay của shop), còn việc người đó
// có thật sự là thành viên với vai đó hay không luôn được kiểm lại bằng dữ liệu DB, không tin tham số.
//  - BUYER: phải là người mua của hội thoại;
//  - SHOP : `shopId` (từ ShopOwnerGuard, đã xác nhận người gọi sở hữu shop đó) phải đúng là shop của hội thoại
//           VÀ người gọi là chủ shop hiện tại trong DB.
export type ChatActor =
  | { kind: 'BUYER'; userId: string }
  | { kind: 'SHOP'; userId: string; shopId: string };

export interface SendMessageResult {
  message: ChatMessage;
  // true = gửi lại một tin ĐÃ được nhận (cùng clientMessageId): trả tin cũ, không ghi và không đẩy lại. Controller
  // dùng để trả 200 thay vì 201.
  replayed: boolean;
}

// Nghiệp vụ chat (Week10.md Bước 4). Module `chat` KHÔNG import module nghiệp vụ nào khác
// (module-boundaries.spec.ts): thông tin shop đi qua cổng ChatDirectory, còn bảng của chính chat đọc/ghi thẳng
// bằng Prisma với `select` hẹp. Hiện có: mở hội thoại (4.3), gửi tin (4.4); đọc ở 4.5.
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHAT_DIRECTORY) private readonly directory: ChatDirectory,
    @Inject(REALTIME_EMITTER) private readonly realtime: RealtimeEmitter,
  ) {}

  // Người mua mở (hoặc lấy lại) hội thoại với một shop. IDEMPOTENT: gọi lại trả đúng hội thoại cũ, nên nút
  // "Chat với shop" bấm nhiều lần hay hai tab cùng bấm cũng chỉ có một hàng.
  //
  // Thứ tự kiểm tra có chủ ý:
  //  1. shop không tồn tại HOẶC chưa/không còn APPROVED ⇒ 404 như trang công khai của shop (không lộ shop nháp
  //     hay bị khoá có tồn tại hay không);
  //  2. chủ shop không nhắn cho shop của chính mình ⇒ 409 CHAT_OWN_SHOP;
  //  3. hội thoại ĐÃ có ⇒ trả luôn, KHÔNG tính vào giới hạn (mở lại không phải "mở mới");
  //  4. chưa có ⇒ kiểm trần hội thoại mới trong ngày rồi tạo.
  async openConversation(
    buyerId: string,
    shopId: string,
  ): Promise<ConversationSummary> {
    const shop = await this.directory.getShopForChat(shopId);
    if (!shop || shop.status !== ShopStatus.APPROVED) {
      throw new NotFoundException('Shop not found');
    }
    if (shop.ownerId === buyerId) {
      throw new AppException(
        409,
        'CHAT_OWN_SHOP',
        'You cannot start a conversation with your own shop',
      );
    }

    let conversation = await this.findConversation(buyerId, shop.id);
    if (!conversation) {
      await this.assertCanStartNewConversation(buyerId);
      conversation = await this.createOrGetExisting(buyerId, shop.id);
    }
    return this.toBuyerSummary(conversation, shop);
  }

  // Gửi một tin (Week10.md 4.4). Thứ tự có chủ ý:
  //  1. nội dung được kiểm lại bằng chính schema dùng chung (trim/độ dài/ký tự) — service không tin người gọi đã
  //     validate; kiểm trước mọi truy vấn nên 400 xảy ra đồng đều, không lộ hội thoại nào tồn tại;
  //  2. vai người gửi suy ra từ DB; không phải thành viên ⇒ 404 (không lộ hội thoại tồn tại);
  //  3. shop không còn APPROVED ⇒ 409 CHAT_SHOP_UNAVAILABLE (hội thoại chỉ đọc);
  //  4. gửi lại tin ĐÃ nhận (cùng clientMessageId) ⇒ trả tin cũ, TRƯỚC các giới hạn: thử lại sau mất mạng không
  //     được tính là gửi thêm và không bị chặn oan;
  //  5. giới hạn tốc độ rồi giới hạn tin liên tiếp chưa được trả lời (đều đếm bằng DB);
  //  6. ghi tin + cập nhật hội thoại trong MỘT transaction; sau commit mới đẩy real-time (không bao giờ ném).
  async sendMessage(
    actor: ChatActor,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<SendMessageResult> {
    const content = this.parseContent(input.content);
    const { conversation, shop, role } = await this.requireParticipant(
      actor,
      conversationId,
    );
    if (shop.status !== ShopStatus.APPROVED) {
      throw new AppException(
        409,
        'CHAT_SHOP_UNAVAILABLE',
        'This shop is not accepting new messages',
      );
    }

    const replay = await this.findByClientMessageId(
      conversation.id,
      actor.userId,
      input.clientMessageId,
    );
    if (replay) {
      return {
        message: this.toChatMessage(replay, conversation.buyerId, true),
        replayed: true,
      };
    }

    await this.assertSendRate(actor.userId);
    if (role === 'BUYER') {
      await this.assertNotAwaitingReply(conversation.id, conversation.buyerId);
    }

    let created: MessageRow;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderId: actor.userId,
            content,
            clientMessageId: input.clientMessageId,
          },
          select: MESSAGE_SELECT,
        });
        await this.bumpConversation(
          tx,
          conversation.id,
          role,
          message.createdAt,
        );
        return message;
      });
    } catch (error) {
      // Hai request đồng thời cùng clientMessageId: UNIQUE chỉ cho một cái ghi, cái thua đọc lại tin của cái thắng.
      if (isMessageUniqueViolation(error)) {
        const winner = await this.findByClientMessageId(
          conversation.id,
          actor.userId,
          input.clientMessageId,
        );
        if (winner) {
          return {
            message: this.toChatMessage(winner, conversation.buyerId, true),
            replayed: true,
          };
        }
      }
      throw error;
    }

    await this.publishMessage(conversation, shop, created, role);
    return {
      message: this.toChatMessage(created, conversation.buyerId, true),
      replayed: false,
    };
  }

  private parseContent(raw: string): string {
    const parsed = chatMessageContentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid message',
      );
    }
    return parsed.data;
  }

  // Xác định người gọi có phải thành viên với ĐÚNG vai của route hay không, hoàn toàn từ dữ liệu DB. Mọi lý do từ
  // chối (hội thoại không tồn tại, của người khác, của shop khác, người lạ) đều ra CÙNG một 404 để không lộ
  // hội thoại tồn tại.
  private async requireParticipant(
    actor: ChatActor,
    conversationId: string,
  ): Promise<{
    conversation: ConversationRow;
    shop: ChatShopInfo;
    role: ChatRole;
  }> {
    const notFound = () => new NotFoundException('Conversation not found');
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: CONVERSATION_SELECT,
    });
    if (!conversation) throw notFound();
    const shop = await this.directory.getShopForChat(conversation.shopId);
    if (!shop) throw notFound();

    if (actor.kind === 'BUYER') {
      if (conversation.buyerId !== actor.userId) throw notFound();
      return { conversation, shop, role: 'BUYER' };
    }
    if (conversation.shopId !== actor.shopId || shop.ownerId !== actor.userId) {
      throw notFound();
    }
    return { conversation, shop, role: 'SHOP' };
  }

  private findByClientMessageId(
    conversationId: string,
    senderId: string,
    clientMessageId: string,
  ): Promise<MessageRow | null> {
    return this.prisma.message.findUnique({
      where: {
        conversationId_senderId_clientMessageId: {
          conversationId,
          senderId,
          clientMessageId,
        },
      },
      select: MESSAGE_SELECT,
    });
  }

  // Giới hạn tốc độ: số tin của người gửi (trên MỌI hội thoại) trong cửa sổ ngắn, đếm bằng truy vấn trên
  // messages (sender_id, created_at). Xem chat-config.ts về lý do dùng DB thay vì bộ nhớ.
  private async assertSendRate(senderId: string): Promise<void> {
    const since = new Date(Date.now() - CHAT_SEND_RATE_WINDOW_MS);
    const recent = await this.prisma.message.count({
      where: { senderId, createdAt: { gt: since } },
    });
    if (recent >= CHAT_SEND_RATE_LIMIT) {
      throw new AppException(
        429,
        'CHAT_RATE_LIMITED',
        'You are sending messages too fast, please slow down',
      );
    }
  }

  // Trần tin liên tiếp chưa được trả lời của người mua: đếm tin của người mua SAU tin cuối của shop trong hội
  // thoại này (chưa từng có tin của shop ⇒ đếm mọi tin của người mua). Shop trả lời là tự mở lại.
  private async assertNotAwaitingReply(
    conversationId: string,
    buyerId: string,
  ): Promise<void> {
    const lastShopMessage = await this.prisma.message.findFirst({
      where: { conversationId, senderId: { not: buyerId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
    const unanswered = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: buyerId,
        ...(lastShopMessage
          ? { createdAt: { gt: lastShopMessage.createdAt } }
          : {}),
      },
    });
    if (unanswered >= CHAT_MAX_UNANSWERED_MESSAGES) {
      throw new AppException(
        429,
        'CHAT_AWAITING_REPLY',
        'Please wait for the shop to reply before sending more messages',
      );
    }
  }

  // Cập nhật hội thoại CÙNG transaction với tin: thời điểm tin mới nhất và mốc "đã đọc tới" của NGƯỜI GỬI (gửi
  // một tin tức là đã đọc mọi thứ trước nó). Mỗi cột chỉ được TĂNG — UPDATE có điều kiện (không đọc-rồi-ghi): hai
  // tin gửi song song mà commit sai thứ tự không làm mốc lùi về tin cũ hơn.
  private async bumpConversation(
    tx: Prisma.TransactionClient,
    conversationId: string,
    role: ChatRole,
    at: Date,
  ): Promise<void> {
    await tx.conversation.updateMany({
      where: {
        id: conversationId,
        OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: at } }],
      },
      data: { lastMessageAt: at },
    });
    if (role === 'BUYER') {
      await tx.conversation.updateMany({
        where: {
          id: conversationId,
          OR: [{ buyerLastReadAt: null }, { buyerLastReadAt: { lt: at } }],
        },
        data: { buyerLastReadAt: at },
      });
    } else {
      await tx.conversation.updateMany({
        where: {
          id: conversationId,
          OR: [{ shopLastReadAt: null }, { shopLastReadAt: { lt: at } }],
        },
        data: { shopLastReadAt: at },
      });
    }
  }

  // Đẩy `chat:message` tới CẢ HAI phía, kể cả người vừa gửi (để các tab khác của họ đồng bộ). Chạy SAU commit và
  // KHÔNG BAO GIỜ ném (rules/backend.md mục 4): tin đã nằm trong DB, người nhận không thấy ngay thì tải lại sẽ
  // thấy. `clientMessageId` chỉ đi trong bản của người gửi (để đối chiếu tin tạm). Log chỉ có id — không nội dung.
  private async publishMessage(
    conversation: ConversationRow,
    shop: ChatShopInfo,
    message: MessageRow,
    senderRole: ChatRole,
  ): Promise<void> {
    try {
      const recipients: { userId: string; viewerRole: ChatRole }[] = [
        { userId: conversation.buyerId, viewerRole: 'BUYER' },
        { userId: shop.ownerId, viewerRole: 'SHOP' },
      ];
      await Promise.all(
        recipients.map(({ userId, viewerRole }) => {
          const payload: ChatMessageEvent = {
            message: this.toChatMessage(
              message,
              conversation.buyerId,
              viewerRole === senderRole,
            ),
            viewerRole,
            shopId: shop.id,
          };
          return this.realtime.emitToUser(
            userId,
            REALTIME_EVENTS.chatMessage,
            payload,
          );
        }),
      );
    } catch (error) {
      this.logger.error(
        `Pushing chat message ${message.id} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private toChatMessage(
    row: MessageRow,
    buyerId: string,
    includeClientMessageId: boolean,
  ): ChatMessage {
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderRole: roleOf(row.senderId, buyerId),
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      ...(includeClientMessageId && row.clientMessageId
        ? { clientMessageId: row.clientMessageId }
        : {}),
    };
  }

  private findConversation(
    buyerId: string,
    shopId: string,
  ): Promise<ConversationRow | null> {
    return this.prisma.conversation.findUnique({
      where: { buyerId_shopId: { buyerId, shopId } },
      select: CONVERSATION_SELECT,
    });
  }

  // Trần hội thoại MỚI trong cửa sổ trượt, đếm bằng truy vấn (không dùng bộ nhớ — xem chat-config.ts). Chỉ đếm
  // hội thoại tạo SAU `now - WINDOW`: tạo đúng WINDOW trước thì đã ra khỏi cửa sổ.
  private async assertCanStartNewConversation(buyerId: string): Promise<void> {
    const since = new Date(Date.now() - CHAT_NEW_CONVERSATIONS_WINDOW_MS);
    const recent = await this.prisma.conversation.count({
      where: { buyerId, createdAt: { gt: since } },
    });
    if (recent >= CHAT_NEW_CONVERSATIONS_LIMIT) {
      throw new AppException(
        429,
        'CHAT_CONVERSATION_LIMIT',
        'Too many new conversations started recently, please try again later',
      );
    }
  }

  // Hai request đồng thời cùng (người mua, shop) đều thấy "chưa có" rồi cùng tạo: `@@unique([buyerId, shopId])`
  // là trọng tài cuối, người thua nhận P2002 ⇒ đọc lại hàng của người thắng (rules/backend.md mục 4). Chỉ coi
  // là "trùng hội thoại" khi P2002 đúng của model Conversation — không dựa vào việc bảng này chỉ có một ràng
  // buộc unique.
  private async createOrGetExisting(
    buyerId: string,
    shopId: string,
  ): Promise<ConversationRow> {
    try {
      return await this.prisma.conversation.create({
        data: { buyerId, shopId },
        select: CONVERSATION_SELECT,
      });
    } catch (error) {
      if (isConversationUniqueViolation(error)) {
        const existing = await this.findConversation(buyerId, shopId);
        if (existing) return existing;
      }
      throw error;
    }
  }

  // Góc nhìn của NGƯỜI MUA: đối phương là shop. Chỉ tên và logo shop — không bao giờ thông tin chủ shop.
  // Hội thoại chưa có tin (lastMessageAt NULL — cột này chỉ được ghi cùng transaction với tin) khỏi tốn thêm
  // truy vấn.
  private async toBuyerSummary(
    conversation: ConversationRow,
    shop: ChatShopInfo,
  ): Promise<ConversationSummary> {
    const base = {
      id: conversation.id,
      shopId: conversation.shopId,
      counterpart: { name: shop.name, logoUrl: shop.logoUrl },
      isReadOnly: shop.status !== ShopStatus.APPROVED,
    };
    if (!conversation.lastMessageAt) {
      return {
        ...base,
        lastMessage: null,
        lastMessageAt: null,
        unreadCount: 0,
      };
    }

    const [last, unreadCount] = await Promise.all([
      this.prisma.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { content: true, senderId: true, createdAt: true },
      }),
      // Chưa đọc của người mua = tin do ĐỐI PHƯƠNG gửi, sau mốc "đã đọc tới" của người mua (NULL = chưa đọc lần nào).
      this.prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: conversation.buyerId },
          ...(conversation.buyerLastReadAt
            ? { createdAt: { gt: conversation.buyerLastReadAt } }
            : {}),
        },
      }),
    ]);

    return {
      ...base,
      lastMessage: last
        ? {
            content: toPreview(last.content),
            senderRole: roleOf(last.senderId, conversation.buyerId),
            createdAt: last.createdAt.toISOString(),
          }
        : null,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      unreadCount,
    };
  }
}

// Vai của người gửi trong hội thoại — luôn suy ra từ DB (buyerId của hội thoại), không bao giờ từ client.
function roleOf(senderId: string, buyerId: string): ChatRole {
  return senderId === buyerId ? 'BUYER' : 'SHOP';
}

function uniqueViolationOf(
  error: unknown,
): { modelName?: string; target?: unknown } | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return null;
  }
  return error.meta ?? {};
}

function isConversationUniqueViolation(error: unknown): boolean {
  const meta = uniqueViolationOf(error);
  if (!meta) return false;
  if (meta.modelName) return meta.modelName === 'Conversation';
  // Một số phiên bản Prisma chỉ trả `target` (tên cột hoặc tên chỉ mục).
  return (
    Array.isArray(meta.target) &&
    (meta.target as unknown[]).includes('buyer_id')
  );
}

function isMessageUniqueViolation(error: unknown): boolean {
  const meta = uniqueViolationOf(error);
  if (!meta) return false;
  if (meta.modelName) return meta.modelName === 'Message';
  return (
    Array.isArray(meta.target) &&
    (meta.target as unknown[]).includes('client_message_id')
  );
}
