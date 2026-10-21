import { useQuery } from '@tanstack/react-query';

import { shouldRetryQuery } from '@/shared/lib/should-retry-query';

import * as chatService from '../services/chat.service';
import type { ChatScope } from '../types';
import { unreadCountQueryKey } from './chat-query-keys';
import { useStableChatScope } from './useStableChatScope';

// Tổng số tin chưa đọc của một phạm vi, cho huy hiệu ở Header/menu (mỗi vai một con số: người dùng vừa mua vừa bán có
// hai huy hiệu riêng). Giá trị là MỘT SỐ (`data`), không phải object. Huy hiệu hiện ở mọi trang nên `enabled` BẮT
// BUỘC do nơi gọi quyết định (khách vãng lai không được gọi API này — truyền `enabled: false`).
export function useChatUnreadCount(scope: ChatScope, options: { enabled: boolean }) {
  const stableScope = useStableChatScope(scope);

  return useQuery({
    queryKey: unreadCountQueryKey(stableScope),
    queryFn: () => chatService.getUnreadCount(stableScope),
    select: (data) => data.unreadCount,
    enabled: options.enabled,
    retry: shouldRetryQuery,
  });
}
