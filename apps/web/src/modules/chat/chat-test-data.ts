import type { InfiniteData } from '@tanstack/react-query';

import type { ConversationsData, MessagesData } from './hooks/chat-cache';
import type { ChatMessage, ConversationSummary } from './types';

// Dữ liệu mẫu CHỈ cho test của module chat (không import từ mã chạy thật). Mọi id đều là UUID hợp lệ vì payload
// real-time và response API đi qua Zod `.uuid()`.

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const CONVERSATION_ID = uuid(1001);
export const OTHER_CONVERSATION_ID = uuid(1002);
export const SHOP_ID = uuid(2001);
export const OTHER_SHOP_ID = uuid(2002);

// Mốc thời gian ISO cố định: `at(0)` là gốc, mỗi đơn vị là một giây.
export function at(seconds: number): string {
  return new Date(Date.parse('2030-01-02T12:00:00.000Z') + seconds * 1000).toISOString();
}

export function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: uuid(1),
    conversationId: CONVERSATION_ID,
    senderRole: 'BUYER',
    content: 'xin chào',
    createdAt: at(0),
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: CONVERSATION_ID,
    shopId: SHOP_ID,
    counterpart: { name: 'Shop Áo', logoUrl: null },
    lastMessage: { content: 'xin chào', senderRole: 'SHOP', createdAt: at(0) },
    lastMessageAt: at(0),
    unreadCount: 0,
    otherLastReadAt: null,
    isReadOnly: false,
    ...overrides,
  };
}

// Mỗi mảng là một trang (mới nhất trước); `nextCursor` là 'cursor-<chỉ số trang>' trừ trang cuối là null.
export function messagesData(...pages: ChatMessage[][]): MessagesData {
  return {
    pages: pages.map((items, index) => ({
      items,
      nextCursor: index === pages.length - 1 ? null : `cursor-${index}`,
    })),
    pageParams: pages.map((_, index) => (index === 0 ? undefined : `cursor-${index - 1}`)),
  };
}

export function conversationsData(...pages: ConversationSummary[][]): ConversationsData {
  return {
    pages: pages.map((items, index) => ({
      items,
      nextCursor: index === pages.length - 1 ? null : `cursor-${index}`,
    })),
    pageParams: pages.map((_, index) => (index === 0 ? undefined : `cursor-${index - 1}`)),
  };
}

export type { InfiniteData };
