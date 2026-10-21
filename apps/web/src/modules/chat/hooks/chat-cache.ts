import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import { toPreview } from '../chat-preview';
import type {
  ChatMessage,
  ChatRole,
  ChatScope,
  ConversationList,
  ConversationSummary,
  MessageList,
  UnreadCount,
} from '../types';
import {
  conversationsQueryKey,
  messagesQueryKey,
  otherReadMarkQueryKey,
  unreadCountQueryKey,
} from './chat-query-keys';

// Các hàm THUẦN ghi thẳng vào cache TanStack Query (không phải hook) cho dữ liệu chat đến từ server, dùng chung cho
// hook mutation và bộ xử lý sự kiện real-time. Quy ước: chỉ sửa cache ĐÃ có dữ liệu — một query chưa từng được nạp
// mà bị `setQueryData` sẽ có "dữ liệu" giả (mới một phần) khiến hook bỏ qua việc nạp lần đầu; chưa có cache thì để
// lần nạp sau lấy bản đầy đủ từ server.

export type MessagesData = InfiniteData<MessageList, string | undefined>;
export type ConversationsData = InfiniteData<ConversationList, string | undefined>;

// Mới nhất trước, hoà thì id lớn trước — đúng thứ tự BE (`ORDER BY created_at DESC, id DESC`). ISO 8601 cùng định
// dạng (`toISOString`) nên so chuỗi chính là so thời gian.
export function compareNewestFirst(
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

// --- Tin nhắn -----------------------------------------------------------------------------------------------

// Đưa một tin ĐÃ có trên server vào cache của hội thoại: bỏ bản trùng (cùng `id`, hoặc cùng `clientMessageId` — khoá
// này chỉ có trên tin của chính mình) rồi chèn vào TRANG ĐẦU đúng chỗ theo thứ tự thời gian. Trả `true` nếu đã ghi,
// `false` nếu hội thoại chưa nạp tin nào (không làm gì).
export function upsertServerMessage(
  queryClient: QueryClient,
  scope: ChatScope,
  message: ChatMessage,
): boolean {
  const key = messagesQueryKey(scope, message.conversationId);
  const data = queryClient.getQueryData<MessagesData>(key);
  if (!data || data.pages.length === 0) return false;

  const isSame = (item: ChatMessage) =>
    item.id === message.id ||
    (message.clientMessageId != null && item.clientMessageId === message.clientMessageId);
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.filter((item) => !isSame(item)),
  }));
  const [first, ...rest] = pages;
  const index = first.items.findIndex((item) => compareNewestFirst(message, item) <= 0);
  const items =
    index === -1
      ? [...first.items, message]
      : [...first.items.slice(0, index), message, ...first.items.slice(index)];
  queryClient.setQueryData<MessagesData>(key, { ...data, pages: [{ ...first, items }, ...rest] });
  return true;
}

// --- Danh sách hội thoại --------------------------------------------------------------------------------------

export function findConversation(
  data: ConversationsData | undefined,
  conversationId: string,
): ConversationSummary | undefined {
  for (const page of data?.pages ?? []) {
    const found = page.items.find((item) => item.id === conversationId);
    if (found) return found;
  }
  return undefined;
}

export type BumpResult =
  // Đã cập nhật (hoặc danh sách đã phản ánh tin này rồi).
  | { status: 'updated'; previousUnread: number }
  // Danh sách đã nạp nhưng chưa có hội thoại này (hội thoại MỚI, tin đầu tiên): nơi gọi làm mới danh sách.
  | { status: 'missing'; previousUnread: 0 }
  // Danh sách chưa nạp: không có gì để cập nhật.
  | { status: 'no-cache'; previousUnread: 0 };

// Cập nhật dòng của hội thoại theo một tin mới: tin cuối + thời gian, đẩy lên đầu danh sách (mới nhất trước), và số
// chưa đọc. `viewerRole` là vai của NGƯỜI XEM hộp thư (= vai của phạm vi): tin của đối phương thì chưa đọc +1; tin của
// CHÍNH mình thì về 0 — gửi một tin là đã đọc mọi thứ trước nó (BE đặt mốc đọc của người gửi cùng giao dịch).
// Danh sách đã có tin này hoặc tin mới hơn (`lastMessageAt` >= thời gian tin) thì KHÔNG đổi gì: danh sách vừa được tải
// SAU khi tin tới, cộng thêm nữa là đếm đôi.
export function bumpConversationWithMessage(
  queryClient: QueryClient,
  scope: ChatScope,
  message: ChatMessage,
  viewerRole: ChatRole,
): BumpResult {
  const key = conversationsQueryKey(scope);
  const data = queryClient.getQueryData<ConversationsData>(key);
  if (!data || data.pages.length === 0) return { status: 'no-cache', previousUnread: 0 };

  const current = findConversation(data, message.conversationId);
  if (!current) return { status: 'missing', previousUnread: 0 };
  if (current.lastMessageAt !== null && current.lastMessageAt >= message.createdAt) {
    // Không đổi gì ⇒ không xoá chưa đọc nào: `previousUnread` phải là 0, nếu không nơi gọi sẽ trừ khỏi huy hiệu số chưa
    // đọc của một tin KHÁC (vd phản hồi HTTP của tin mình gửi về muộn, sau khi tin trả lời mới hơn đã vào danh sách).
    return { status: 'updated', previousUnread: 0 };
  }

  const fromOtherSide = message.senderRole !== viewerRole;
  const updated: ConversationSummary = {
    ...current,
    lastMessage: {
      content: toPreview(message.content),
      senderRole: message.senderRole,
      createdAt: message.createdAt,
    },
    lastMessageAt: message.createdAt,
    unreadCount: fromOtherSide ? current.unreadCount + 1 : 0,
  };
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.filter((item) => item.id !== message.conversationId),
  }));
  const [first, ...rest] = pages;
  queryClient.setQueryData<ConversationsData>(key, {
    ...data,
    pages: [{ ...first, items: [updated, ...first.items] }, ...rest],
  });
  return { status: 'updated', previousUnread: current.unreadCount };
}

// Đưa số chưa đọc của một hội thoại về 0 (người dùng đã mở/đọc nó). Trả số chưa đọc TRƯỚC đó (0 nếu không có trong
// cache) để nơi gọi trừ khỏi huy hiệu tổng.
export function clearConversationUnread(
  queryClient: QueryClient,
  scope: ChatScope,
  conversationId: string,
): number {
  const key = conversationsQueryKey(scope);
  const data = queryClient.getQueryData<ConversationsData>(key);
  const current = findConversation(data, conversationId);
  if (!data || !current || current.unreadCount === 0) return 0;
  queryClient.setQueryData<ConversationsData>(key, {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.id === conversationId ? { ...item, unreadCount: 0 } : item,
      ),
    })),
  });
  return current.unreadCount;
}

// --- Huy hiệu và dấu đã đọc -------------------------------------------------------------------------------------

// Cộng/trừ vào tổng chưa đọc ĐÃ có trong cache (không đi dưới 0). Chưa có cache thì thôi.
export function adjustUnreadCount(queryClient: QueryClient, scope: ChatScope, delta: number): void {
  const key = unreadCountQueryKey(scope);
  const current = queryClient.getQueryData<UnreadCount>(key);
  if (!current || delta === 0) return;
  queryClient.setQueryData<UnreadCount>(key, {
    unreadCount: Math.max(0, current.unreadCount + delta),
  });
}

// Ghi mốc "đối phương đã đọc tới" — CHỈ TĂNG (sự kiện đến muộn/lệch thứ tự không làm mốc lùi).
export function setOtherReadMark(
  queryClient: QueryClient,
  conversationId: string,
  readAt: string,
): void {
  const key = otherReadMarkQueryKey(conversationId);
  const current = queryClient.getQueryData<string>(key);
  if (current !== undefined && current >= readAt) return;
  queryClient.setQueryData<string>(key, readAt);
}
