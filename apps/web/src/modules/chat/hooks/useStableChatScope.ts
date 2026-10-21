import { useMemo } from 'react';

import type { ChatScope } from '../types';

// `ChatScope` là object nên nơi gọi viết `{ role: 'SHOP', shopId }` inline sẽ sinh identity mới mỗi lần render, làm
// vô hiệu mọi `useCallback`/`useMemo`/effect có scope trong deps. Hook này trả CÙNG một object chừng nào vai và
// shopId không đổi — mọi hook của module chat dùng nó thay vì dùng `scope` thô.
export function useStableChatScope(scope: ChatScope): ChatScope {
  const shopId = scope.role === 'SHOP' ? scope.shopId : undefined;
  return useMemo<ChatScope>(
    () => (shopId === undefined ? { role: 'BUYER' } : { role: 'SHOP', shopId }),
    [shopId],
  );
}
