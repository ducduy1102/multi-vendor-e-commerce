// Barrel export cho module chat — chỉ những gì cần dùng ở app/ và (qua page.tsx) ghép với module khác. Component
// giao diện (hộp thư, khung tin, nút "Chat với shop") được thêm ở các bước sau.
export { ChatInboxContainer } from './components/ChatInboxContainer';
export { ShopChatButton } from './components/ShopChatButton';
export { formatUnread } from './chat-format';
export { parseChatPageQuery } from './chat-page-query';
export { resetChatOutbox } from './store/chat-outbox.store';
export {
  chatScopeQueryKey,
  conversationsQueryKey,
  messagesQueryKey,
  otherReadMarkQueryKey,
  unreadCountQueryKey,
} from './hooks/chat-query-keys';
export {
  isPendingMessage,
  isSeenByOther,
  latestReadMark,
  mergeMessagesWithOutbox,
  type ChatMessageView,
} from './hooks/chat-messages';
export { useChatRealtimeSync } from './hooks/useChatRealtimeSync';
export { useChatUnreadCount } from './hooks/useChatUnreadCount';
export { useConversations } from './hooks/useConversations';
export { useMarkRead } from './hooks/useMarkRead';
export { useMessages, type UseMessagesResult } from './hooks/useMessages';
export { useOpenConversation, useSeededConversation } from './hooks/useOpenConversation';
export { useOtherReadMark } from './hooks/useOtherReadMark';
export { useSendMessage, type UseSendMessageResult } from './hooks/useSendMessage';
export {
  TYPING_EXPIRE_MS,
  TYPING_SEND_INTERVAL_MS,
  useSendTyping,
  useTypingIndicator,
} from './hooks/useTypingIndicator';
export { toPreview } from './chat-preview';
export * as chatService from './services/chat.service';
export type {
  ChatCounterpart,
  ChatDeliveryStatus,
  ChatLastMessage,
  ChatMessage,
  ChatMessageEvent,
  ChatRole,
  ChatScope,
  ChatSendFailure,
  ConversationList,
  ConversationSummary,
  MarkReadResult,
  MessageList,
  UnreadCount,
} from './types';
