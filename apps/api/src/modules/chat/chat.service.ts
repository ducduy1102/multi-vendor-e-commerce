import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShopStatus } from '@prisma/client';
import type { ChatRole, ConversationSummary } from '@ecommerce/types';
import { AppException } from '../../shared/exceptions/app.exception';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  CHAT_NEW_CONVERSATIONS_LIMIT,
  CHAT_NEW_CONVERSATIONS_WINDOW_MS,
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

// Nghiệp vụ chat (Week10.md Bước 4). Module `chat` KHÔNG import module nghiệp vụ nào khác
// (module-boundaries.spec.ts): thông tin shop đi qua cổng ChatDirectory, còn bảng của chính chat đọc/ghi thẳng
// bằng Prisma với `select` hẹp. Hiện có: mở hội thoại (4.3); gửi/đọc tin ở 4.4/4.5.
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHAT_DIRECTORY) private readonly directory: ChatDirectory,
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

function isConversationUniqueViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const meta = error.meta as
    { modelName?: string; target?: unknown } | undefined;
  if (meta?.modelName) return meta.modelName === 'Conversation';
  // Một số phiên bản Prisma chỉ trả `target` (tên cột hoặc tên chỉ mục).
  return (
    Array.isArray(meta?.target) &&
    (meta.target as unknown[]).includes('buyer_id')
  );
}
