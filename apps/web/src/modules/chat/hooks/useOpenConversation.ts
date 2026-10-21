import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as chatService from '../services/chat.service';
import type { ChatScope, ConversationSummary } from '../types';
import { seededConversationQueryKey } from './chat-query-keys';
import { useStableChatScope } from './useStableChatScope';

const BUYER_SCOPE: ChatScope = { role: 'BUYER' };

// Người mua mở (hoặc lấy lại) hội thoại với một shop — nút "Chat với shop". Idempotent: bấm đúp, hai tab cùng bấm
// vẫn chỉ có MỘT hội thoại. Hội thoại vừa mở chưa có tin nên CHƯA nằm trong danh sách (BE chỉ liệt kê hội thoại đã
// có tin), mà giao diện vẫn cần tên + logo đối phương để dựng tiêu đề ⇒ ghi bản tóm tắt vào cache để đọc lại bằng
// useSeededConversation. Lỗi (409 CHAT_OWN_SHOP, 404 shop không còn, 429 mở quá nhiều hội thoại mới...) để nơi gọi
// dịch theo `code` qua useApiErrorMessage.
export function useOpenConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (shopId: string) => chatService.openConversation(shopId),
    onSuccess: (summary) => {
      queryClient.setQueryData(seededConversationQueryKey(BUYER_SCOPE, summary.id), summary);
    },
  });
}

// Đọc bản tóm tắt hội thoại mà useOpenConversation đã ghi (hoặc undefined nếu chưa có — vd tải lại trang khi hội thoại
// còn trống). KHÔNG BAO GIỜ gọi mạng: `skipToken` biến đây thành đọc cache thuần có đăng ký theo dõi thay đổi.
export function useSeededConversation(
  scope: ChatScope,
  conversationId: string | null,
): ConversationSummary | undefined {
  const stableScope = useStableChatScope(scope);
  const { data } = useQuery<ConversationSummary>({
    queryKey: seededConversationQueryKey(stableScope, conversationId ?? ''),
    queryFn: skipToken,
  });
  return conversationId === null ? undefined : data;
}
