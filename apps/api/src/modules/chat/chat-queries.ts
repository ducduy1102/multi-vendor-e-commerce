import { Prisma } from '@prisma/client';
import type { ChatRole } from '@ecommerce/types';
import type { PrismaService } from '../../shared/prisma/prisma.service';

// Hai truy vấn nhóm của phần ĐỌC chat (Week10.md 4.5). Viết bằng SQL thuần vì Prisma không diễn tả được "so sánh
// với một cột của dòng cha" (mốc đã đọc nằm ở `conversations`, tin nằm ở `messages`) và không có "tin cuối của
// MỖI hội thoại" mà không kéo mọi tin về (`distinct` của Prisma lọc trong bộ nhớ).

// Theo vai của NGƯỜI XEM: cột mốc đã đọc của họ, và điều kiện "tin do ĐỐI PHƯƠNG gửi". Người mua là
// `conversations.buyer_id` nên tin của shop là mọi tin có người gửi khác người mua. Đây là hằng cố định, không bao
// giờ từ input, nên dùng `Prisma.raw` được — mọi giá trị thật (id) vẫn đi qua tham số.
const VIEW: Record<
  ChatRole,
  { readMark: Prisma.Sql; fromOtherSide: Prisma.Sql }
> = {
  BUYER: {
    readMark: Prisma.raw('c.buyer_last_read_at'),
    fromOtherSide: Prisma.raw('m.sender_id <> c.buyer_id'),
  },
  SHOP: {
    readMark: Prisma.raw('c.shop_last_read_at'),
    fromOtherSide: Prisma.raw('m.sender_id = c.buyer_id'),
  },
};

export interface ConversationDigest {
  conversationId: string;
  content: string;
  senderId: string;
  createdAt: Date;
  unreadCount: number;
}

// Tin cuối và số chưa đọc của một TRANG hội thoại bằng MỘT truy vấn (không N+1). Mỗi hội thoại: một lần dò
// LATERAL `LIMIT 1` trên (conversation_id, created_at, id) lấy tin cuối, và một lần đếm các tin của đối phương
// sau mốc đã đọc của người xem (NULL = chưa đọc lần nào). Hội thoại không có tin không cho ra dòng nào.
export function findConversationDigests(
  prisma: Pick<PrismaService, '$queryRaw'>,
  conversationIds: string[],
  viewer: ChatRole,
): Promise<ConversationDigest[]> {
  if (conversationIds.length === 0) return Promise.resolve([]);
  return prisma.$queryRaw<ConversationDigest[]>(
    buildDigestQuery(conversationIds, viewer),
  );
}

// Tách riêng câu SQL để test có thể chạy EXPLAIN đúng câu truy vấn thật.
export function buildDigestQuery(
  conversationIds: string[],
  viewer: ChatRole,
): Prisma.Sql {
  const { readMark, fromOtherSide } = VIEW[viewer];
  return Prisma.sql`
    SELECT c.id AS "conversationId",
           last_message.content AS "content",
           last_message.sender_id AS "senderId",
           last_message.created_at AS "createdAt",
           unread.total AS "unreadCount"
    FROM conversations c
    CROSS JOIN LATERAL (
      SELECT m.content, m.sender_id, m.created_at
      FROM messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) last_message
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS total
      FROM messages m
      WHERE m.conversation_id = c.id
        AND ${fromOtherSide}
        AND (${readMark} IS NULL OR m.created_at > ${readMark})
    ) unread
    WHERE c.id = ANY(${conversationIds}::text[])
  `;
}

export type UnreadScope =
  // Mọi hội thoại của một người mua.
  | { viewer: 'BUYER'; userId: string }
  // Mọi hội thoại của một shop (người gọi đã được xác nhận là chủ shop).
  | { viewer: 'SHOP'; shopId: string };

// Tổng số tin chưa đọc cho huy hiệu: tin của đối phương sau mốc đã đọc của người xem, trên mọi hội thoại trong
// phạm vi. Mỗi vai một con số (một người vừa là người mua vừa là chủ shop có hai huy hiệu riêng).
export async function countUnreadMessages(
  prisma: Pick<PrismaService, '$queryRaw'>,
  scope: UnreadScope,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: number }[]>(
    buildUnreadCountQuery(scope),
  );
  return rows[0]?.total ?? 0;
}

export function buildUnreadCountQuery(scope: UnreadScope): Prisma.Sql {
  const { readMark, fromOtherSide } = VIEW[scope.viewer];
  const inScope =
    scope.viewer === 'BUYER'
      ? Prisma.sql`c.buyer_id = ${scope.userId}`
      : Prisma.sql`c.shop_id = ${scope.shopId}`;
  return Prisma.sql`
    SELECT count(*)::int AS "total"
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE ${inScope}
      AND ${fromOtherSide}
      AND (${readMark} IS NULL OR m.created_at > ${readMark})
  `;
}
