import { skipToken, useQuery } from '@tanstack/react-query';

import { latestReadMark } from './chat-messages';
import { otherReadMarkQueryKey } from './chat-query-keys';

// Mốc "đối phương đã đọc tới" của một hội thoại, cho dấu "Đã xem". Hai nguồn, lấy cái MỚI hơn (mốc chỉ tăng):
//  - `fromSummary`: `otherLastReadAt` trong bản tóm tắt hội thoại (danh sách / `useSeededConversation`) — giữ nguyên
//    sau khi tải lại trang;
//  - sự kiện `chat:read` (do `useChatRealtimeSync` ghi vào cache) — cập nhật tức thời, không cần tải lại danh sách.
// `skipToken` biến đây thành đọc cache thuần có đăng ký theo dõi: KHÔNG BAO GIỜ gọi mạng. null = chưa biết / chưa đọc.
export function useOtherReadMark(
  conversationId: string | null,
  fromSummary: string | null | undefined,
): string | null {
  const { data } = useQuery<string>({
    queryKey: otherReadMarkQueryKey(conversationId ?? ''),
    queryFn: skipToken,
  });
  return conversationId === null ? null : latestReadMark(fromSummary, data);
}
