import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShopStatus } from '@prisma/client';
import type { ZodTypeAny, z } from 'zod';
import {
  chatMessageContentSchema,
  conversationListQuerySchema,
  messageListQuerySchema,
  REALTIME_EVENTS,
  type ChatCounterpart,
  type ChatLastMessage,
  type ChatMessage,
  type ChatMessageEvent,
  type ChatReadPayload,
  type ChatRole,
  type ConversationList,
  type ConversationListQuery,
  type ConversationSummary,
  type MarkReadResult,
  type MessageList,
  type MessageListQuery,
  type SendMessageInput,
  type UnreadCount,
} from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { redactWriteError } from '../../shared/utils/redact-write-error';
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
import {
  decodeChatCursor,
  encodeChatCursor,
  type ChatCursor,
} from './chat-cursor';
import {
  countUnreadMessages,
  findConversationDigests,
  type ConversationDigest,
} from './chat-queries';

// Chỉ những cột dùng để dựng ConversationSummary và để đánh dấu đã đọc — không kéo cả hàng.
const CONVERSATION_SELECT = {
  id: true,
  buyerId: true,
  shopId: true,
  createdAt: true,
  buyerLastReadAt: true,
  shopLastReadAt: true,
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

// Hộp thư đang xem: tập hội thoại cần liệt kê. Chủ shop mang theo ChatShopInfo đã xác nhận (đã kiểm sở hữu).
type Inbox =
  | { role: 'BUYER'; where: Prisma.ConversationWhereInput }
  | {
      role: 'SHOP';
      where: Prisma.ConversationWhereInput;
      shop: ChatShopInfo;
    };

// Đối phương của một hội thoại trong mắt người xem, và hội thoại có đang chỉ đọc không (shop không còn APPROVED).
interface ConversationParty {
  counterpart: ChatCounterpart;
  isReadOnly: boolean;
}

export interface SendMessageResult {
  message: ChatMessage;
  // true = gửi lại một tin ĐÃ được nhận (cùng clientMessageId): trả tin cũ, không ghi và không đẩy lại. Controller
  // dùng để trả 200 thay vì 201.
  replayed: boolean;
}

// Nghiệp vụ chat (Week10.md Bước 4). Module `chat` KHÔNG import module nghiệp vụ nào khác
// (module-boundaries.spec.ts): thông tin shop đi qua cổng ChatDirectory, còn bảng của chính chat đọc/ghi thẳng
// bằng Prisma với `select` hẹp. Hiện có: mở hội thoại (4.3), gửi tin (4.4), đọc/đánh dấu đã đọc (4.5).
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
      // Lỗi ghi của Prisma có thể mang nguyên nội dung tin vào message/stack (xem shared/utils/redact-write-error.ts).
      throw redactWriteError(error, 'chat message');
    }

    await this.publishMessage(conversation, shop, created, role);
    return {
      message: this.toChatMessage(created, conversation.buyerId, true),
      replayed: false,
    };
  }

  // Danh sách hội thoại của MỘT phía (Week10.md 4.5): người mua xem các shop mình đã nhắn, chủ shop xem những người
  // đã nhắn shop mình (`actor.shopId`, được xác nhận lại với DB). Chỉ hội thoại ĐÃ có tin, tin mới nhất trước,
  // phân trang theo con trỏ (lastMessageAt, id). Tin cuối và số chưa đọc của cả trang lấy bằng MỘT truy vấn nhóm,
  // thông tin đối phương bằng MỘT lượt tra danh bạ — số truy vấn không phụ thuộc số hội thoại. Hội thoại của shop
  // đã bị khoá vẫn hiện (`isReadOnly`) để người mua đọc lại lịch sử.
  async listConversations(
    actor: ChatActor,
    input: ConversationListQuery,
  ): Promise<ConversationList> {
    const query = this.parseQuery(conversationListQuerySchema, input);
    const cursor = this.decodeCursor(query.before);
    const inbox = await this.resolveInbox(actor);

    const rows = await this.prisma.conversation.findMany({
      where: {
        ...inbox.where,
        lastMessageAt: { not: null },
        ...(cursor
          ? {
              OR: [
                { lastMessageAt: { lt: cursor.at } },
                { lastMessageAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: CONVERSATION_SELECT,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    if (page.length === 0) return { items: [], nextCursor: null };

    const [digests, parties] = await Promise.all([
      findConversationDigests(
        this.prisma,
        page.map((conversation) => conversation.id),
        inbox.role,
      ),
      this.loadParties(inbox, page),
    ]);
    const digestById = new Map(digests.map((d) => [d.conversationId, d]));

    const items: ConversationSummary[] = [];
    for (const conversation of page) {
      const digest = digestById.get(conversation.id);
      const party = parties.get(conversation.id);
      // Không thể xảy ra (hội thoại có `lastMessageAt` thì có tin, shop/người dùng không bị xoá riêng lẻ), nhưng
      // một dòng thiếu dữ liệu không được làm hỏng cả trang.
      if (!digest || !party || !conversation.lastMessageAt) continue;
      items.push({
        id: conversation.id,
        shopId: conversation.shopId,
        counterpart: party.counterpart,
        lastMessage: this.toLastMessage(digest, conversation.buyerId),
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        unreadCount: digest.unreadCount,
        otherLastReadAt: otherReadMarkOf(conversation, inbox.role),
        isReadOnly: party.isReadOnly,
      });
    }

    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last?.lastMessageAt
          ? encodeChatCursor({ at: last.lastMessageAt, id: last.id })
          : null,
    };
  }

  // Một trang tin của hội thoại, MỚI NHẤT trước; `nextCursor` = con trỏ của tin cuối trang (null = hết). Cho phép
  // cả khi shop không còn APPROVED (chế độ chỉ đọc). Không phải thành viên ⇒ 404. `clientMessageId` chỉ có trên
  // tin do chính người xem gửi (để đối chiếu tin tạm sau khi tải lại trang).
  async listMessages(
    actor: ChatActor,
    conversationId: string,
    input: MessageListQuery,
  ): Promise<MessageList> {
    const query = this.parseQuery(messageListQuerySchema, input);
    const cursor = this.decodeCursor(query.before);
    const { conversation } = await this.requireParticipant(
      actor,
      conversationId,
    );

    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.at } },
                { createdAt: cursor.at, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: MESSAGE_SELECT,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];

    return {
      items: page.map((row) =>
        this.toChatMessage(
          row,
          conversation.buyerId,
          row.senderId === actor.userId,
        ),
      ),
      nextCursor:
        hasMore && last
          ? encodeChatCursor({ at: last.createdAt, id: last.id })
          : null,
    };
  }

  // Đánh dấu "đã đọc tới" tin mới nhất của hội thoại (Week10.md 4.5, D7). Mốc là `lastMessageAt` của hội thoại,
  // KHÔNG phải "bây giờ". `created_at` của tin do query engine của Prisma đóng dấu trong tiến trình API ngay khi
  // bắt đầu request (không phải DB đặt), nên mốc "bây giờ" có hai kẽ hở: (1) giữa lúc đóng dấu và lúc commit có
  // khoảng trễ — một tin đã đóng dấu nhưng chưa commit sẽ hiện ra sau với `createdAt` nhỏ hơn mốc và bị coi là đã
  // đọc dù người dùng chưa thấy; (2) chạy nhiều instance thì đồng hồ mỗi nơi lệch nhau. `lastMessageAt` không bao
  // giờ vượt tin mới nhất đã commit nên không "ăn" tin nào chưa tới. Mốc CHỈ TĂNG: UPDATE có điều kiện
  // (NULL hoặc cũ hơn) nên gọi lại, gọi đồng thời hay gọi sau khi đã đọc xa hơn đều không bao giờ làm mốc lùi.
  // `chat:read` chỉ được đẩy khi mốc THẬT SỰ nhích lên và chỉ tới ĐÚNG đối phương (suy ra từ DB): gọi lặp không
  // spam, và hội thoại chưa có tin (đối phương chưa hề thấy nó tồn tại) không lộ gì.
  async markRead(
    actor: ChatActor,
    conversationId: string,
  ): Promise<MarkReadResult> {
    const { conversation, shop, role } = await this.requireParticipant(
      actor,
      conversationId,
    );
    const current =
      role === 'BUYER'
        ? conversation.buyerLastReadAt
        : conversation.shopLastReadAt;
    const target = conversation.lastMessageAt;
    if (!target) {
      return { readAt: (current ?? conversation.createdAt).toISOString() };
    }

    const advanced = await this.advanceReadMark(
      this.prisma,
      conversation.id,
      role,
      target,
    );
    const readAt = current && current > target ? current : target;
    if (advanced) {
      await this.publishRead(
        role === 'BUYER' ? shop.ownerId : conversation.buyerId,
        { conversationId: conversation.id, readAt: target.toISOString() },
      );
    }
    return { readAt: readAt.toISOString() };
  }

  // Tổng số tin chưa đọc cho huy hiệu — mỗi vai một con số (người mua: mọi hội thoại của mình; chủ shop: mọi hội
  // thoại của shop). Đếm bằng truy vấn so với mốc đã đọc, không có bộ đếm phi chuẩn hoá (D7).
  async unreadCount(actor: ChatActor): Promise<UnreadCount> {
    if (actor.kind === 'BUYER') {
      return {
        unreadCount: await countUnreadMessages(this.prisma, {
          viewer: 'BUYER',
          userId: actor.userId,
        }),
      };
    }
    const shop = await this.requireOwnedShop(actor);
    return {
      unreadCount: await countUnreadMessages(this.prisma, {
        viewer: 'SHOP',
        shopId: shop.id,
      }),
    };
  }

  private parseQuery<S extends ZodTypeAny>(
    schema: S,
    input: unknown,
  ): z.output<S> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid query',
      );
    }
    return parsed.data as z.output<S>;
  }

  private decodeCursor(before: string | undefined): ChatCursor | null {
    if (before === undefined) return null;
    const cursor = decodeChatCursor(before);
    if (!cursor) throw new BadRequestException('Invalid cursor');
    return cursor;
  }

  // Chủ shop xem hộp thư của shop `actor.shopId`: kiểm lại với DB rằng shop có thật VÀ người gọi là chủ hiện tại
  // (guard ở controller đã kiểm, service không tin). Không phải ⇒ 404. KHÔNG đòi shop APPROVED — shop bị khoá vẫn
  // đọc được hộp thư của mình ở chế độ chỉ đọc.
  private async requireOwnedShop(
    actor: Extract<ChatActor, { kind: 'SHOP' }>,
  ): Promise<ChatShopInfo> {
    const shop = await this.directory.getShopForChat(actor.shopId);
    if (!shop || shop.ownerId !== actor.userId) {
      throw new NotFoundException('Shop not found');
    }
    return shop;
  }

  private async resolveInbox(actor: ChatActor): Promise<Inbox> {
    if (actor.kind === 'BUYER') {
      return { role: 'BUYER', where: { buyerId: actor.userId } };
    }
    const shop = await this.requireOwnedShop(actor);
    return { role: 'SHOP', where: { shopId: shop.id }, shop };
  }

  // Đối phương và trạng thái chỉ đọc của từng hội thoại trong trang, bằng MỘT lượt tra danh bạ. Người mua thấy
  // tên + logo shop; chủ shop thấy tên người mua (không logo — người dùng chưa có ảnh đại diện).
  private async loadParties(
    inbox: Inbox,
    page: ConversationRow[],
  ): Promise<Map<string, ConversationParty>> {
    const parties = new Map<string, ConversationParty>();
    if (inbox.role === 'SHOP') {
      const buyers = new Map(
        (
          await this.directory.getUserDisplay(
            page.map((conversation) => conversation.buyerId),
          )
        ).map((user) => [user.id, user]),
      );
      for (const conversation of page) {
        const buyer = buyers.get(conversation.buyerId);
        if (!buyer) continue;
        parties.set(conversation.id, {
          counterpart: { name: buyer.name, logoUrl: null },
          isReadOnly: inbox.shop.status !== ShopStatus.APPROVED,
        });
      }
      return parties;
    }
    const shops = new Map(
      (
        await this.directory.getShopsForChat(
          page.map((conversation) => conversation.shopId),
        )
      ).map((shop) => [shop.id, shop]),
    );
    for (const conversation of page) {
      const shop = shops.get(conversation.shopId);
      if (!shop) continue;
      parties.set(conversation.id, {
        counterpart: { name: shop.name, logoUrl: shop.logoUrl },
        isReadOnly: shop.status !== ShopStatus.APPROVED,
      });
    }
    return parties;
  }

  private toLastMessage(
    digest: ConversationDigest,
    buyerId: string,
  ): ChatLastMessage {
    return {
      content: toPreview(digest.content),
      senderRole: roleOf(digest.senderId, buyerId),
      createdAt: digest.createdAt.toISOString(),
    };
  }

  // Người nhận tín hiệu "đang gõ" (Week10.md 4.7): đối phương của `userId` trong hội thoại, hoặc null khi `userId`
  // không phải thành viên, hội thoại không tồn tại, hội thoại chưa có tin nào, hay shop không còn APPROVED. Cố ý
  // KHÔNG phân biệt các lý do (nơi gọi chỉ cần biết có người nhận hay không, không dò được hội thoại có thật):
  //  - hội thoại chưa có tin ⇒ đối phương chưa hề thấy nó tồn tại (giống markRead), nên không báo gì cho họ;
  //  - shop bị khoá ⇒ hội thoại chỉ đọc, không còn ai gõ để gửi.
  // Người nhận luôn suy ra từ DB (người mua của hội thoại, hoặc chủ shop HIỆN TẠI), không từ client.
  async resolveTypingRecipient(
    userId: string,
    conversationId: string,
  ): Promise<string | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { buyerId: true, shopId: true, lastMessageAt: true },
    });
    if (!conversation?.lastMessageAt) return null;
    const shop = await this.directory.getShopForChat(conversation.shopId);
    if (!shop || shop.status !== ShopStatus.APPROVED) return null;

    if (conversation.buyerId === userId) return shop.ownerId;
    if (shop.ownerId === userId) return conversation.buyerId;
    return null;
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
    await this.advanceReadMark(tx, conversationId, role, at);
  }

  // Đưa mốc "đã đọc tới" của một phía lên `at` — CHỈ TĂNG: UPDATE có điều kiện (mốc NULL hoặc cũ hơn), không
  // đọc-rồi-ghi, nên hai lần gọi đồng thời hay một lần gọi muộn không bao giờ làm mốc lùi. Trả về mốc có thực sự
  // nhích lên không (false = đã ở mức đó hoặc cao hơn).
  private async advanceReadMark(
    client: Prisma.TransactionClient,
    conversationId: string,
    role: ChatRole,
    at: Date,
  ): Promise<boolean> {
    const result =
      role === 'BUYER'
        ? await client.conversation.updateMany({
            where: {
              id: conversationId,
              OR: [{ buyerLastReadAt: null }, { buyerLastReadAt: { lt: at } }],
            },
            data: { buyerLastReadAt: at },
          })
        : await client.conversation.updateMany({
            where: {
              id: conversationId,
              OR: [{ shopLastReadAt: null }, { shopLastReadAt: { lt: at } }],
            },
            data: { shopLastReadAt: at },
          });
    return result.count > 0;
  }

  // Đẩy `chat:read` tới ĐÚNG đối phương (id suy ra từ DB, không từ client). Payload chỉ có id hội thoại và mốc thời
  // gian — không nội dung, không tên. Chạy SAU khi mốc đã ghi và KHÔNG BAO GIỜ ném (rules/backend.md mục 4).
  private async publishRead(
    recipientId: string,
    payload: ChatReadPayload,
  ): Promise<void> {
    try {
      await this.realtime.emitToUser(
        recipientId,
        REALTIME_EVENTS.chatRead,
        payload,
      );
    } catch (error) {
      this.logger.error(
        `Pushing chat read mark for conversation ${payload.conversationId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
      otherLastReadAt: otherReadMarkOf(conversation, 'BUYER'),
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

// Mốc đọc của ĐỐI PHƯƠNG trong mắt người xem (người mua thấy mốc của shop và ngược lại), dạng ISO hoặc null nếu họ
// chưa đọc lần nào. Chỉ là một mốc thời gian — cùng thông tin `chat:read` đã đẩy cho đối phương.
function otherReadMarkOf(
  conversation: Pick<ConversationRow, 'buyerLastReadAt' | 'shopLastReadAt'>,
  viewer: ChatRole,
): string | null {
  const mark =
    viewer === 'BUYER'
      ? conversation.shopLastReadAt
      : conversation.buyerLastReadAt;
  return mark ? mark.toISOString() : null;
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
