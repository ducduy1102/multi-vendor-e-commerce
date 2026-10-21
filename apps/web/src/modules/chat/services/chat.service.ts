import {
  chatMessageSchema,
  conversationListSchema,
  conversationSummarySchema,
  markReadResultSchema,
  messageListSchema,
  unreadCountSchema,
  type ChatMessage,
  type ConversationList,
  type ConversationSummary,
  type MarkReadResult,
  type MessageList,
  type SendMessageInput,
  type UnreadCount,
} from '@ecommerce/types';

import { apiFetch } from '@/shared/lib/api-client';

import type { ChatScope } from '../types';

// Mọi route chat đều bắt buộc đăng nhập (BE: JwtAuthGuard). Người mua dùng `/conversations`, chủ shop dùng
// `/shops/:shopId/conversations` (ShopOwnerGuard xác nhận chủ sở hữu) — cùng bộ thao tác, khác đường dẫn. `shopId`
// và id hội thoại đều đi qua encodeURIComponent: không tin chúng không chứa ký tự đặc biệt.
function basePath(scope: ChatScope): string {
  return scope.role === 'BUYER'
    ? '/conversations'
    : `/shops/${encodeURIComponent(scope.shopId)}/conversations`;
}

function withQuery(path: string, params: { before?: string; limit?: number }): string {
  const query = new URLSearchParams();
  if (params.before) query.set('before', params.before);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

// Hộp thư: các hội thoại ĐÃ có tin, mới nhất trước, phân trang theo con trỏ mờ `before` (= `nextCursor` của trang trước).
export async function listConversations(
  scope: ChatScope,
  params: { before?: string; limit?: number } = {},
): Promise<ConversationList> {
  const data = await apiFetch<unknown>(withQuery(basePath(scope), params), { method: 'GET' });
  return conversationListSchema.parse(data);
}

// Tổng số tin chưa đọc cho huy hiệu — mỗi vai một con số.
export async function getUnreadCount(scope: ChatScope): Promise<UnreadCount> {
  const data = await apiFetch<unknown>(`${basePath(scope)}/unread-count`, { method: 'GET' });
  return unreadCountSchema.parse(data);
}

// Một trang tin của hội thoại, MỚI NHẤT trước.
export async function listMessages(
  scope: ChatScope,
  conversationId: string,
  params: { before?: string; limit?: number } = {},
): Promise<MessageList> {
  const data = await apiFetch<unknown>(
    withQuery(`${basePath(scope)}/${encodeURIComponent(conversationId)}/messages`, params),
    { method: 'GET' },
  );
  return messageListSchema.parse(data);
}

// Gửi một tin. IDEMPOTENT theo `clientMessageId`: gửi lại cùng khoá (mất mạng, bấm đúp) BE trả đúng tin cũ (200)
// thay vì tạo bản sao (201) — nơi gọi không cần phân biệt hai trường hợp nên chỉ nhận lại tin.
export async function sendMessage(
  scope: ChatScope,
  conversationId: string,
  input: SendMessageInput,
): Promise<ChatMessage> {
  const data = await apiFetch<unknown>(
    `${basePath(scope)}/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return chatMessageSchema.parse(data);
}

// Đánh dấu đã đọc tới tin mới nhất. Mốc chỉ tăng, gọi lặp an toàn.
export async function markRead(scope: ChatScope, conversationId: string): Promise<MarkReadResult> {
  const data = await apiFetch<unknown>(
    `${basePath(scope)}/${encodeURIComponent(conversationId)}/read`,
    { method: 'POST' },
  );
  return markReadResultSchema.parse(data);
}

// CHỈ người mua mở được hội thoại (chủ shop không nhắn trước). Idempotent: mở lại trả cùng hội thoại.
export async function openConversation(shopId: string): Promise<ConversationSummary> {
  const data = await apiFetch<unknown>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ shopId }),
  });
  return conversationSummarySchema.parse(data);
}
