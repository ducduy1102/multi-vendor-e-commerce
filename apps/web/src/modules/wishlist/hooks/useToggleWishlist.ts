import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WishlistStatus } from '@ecommerce/types';

import * as wishlistService from '../services/wishlist.service';
import { wishlistStatusQueryKey } from './useWishlistStatus';

// Optimistic update — đổi trạng thái heart icon ngay khi bấm, không chờ
// round-trip API (Week5.md Bước 3.4). Nhận thẳng `nextIsWishlisted` (đảo
// ngược trạng thái hiện tại, tính sẵn ở WishlistButton) thay vì tự đọc lại
// cache trong mutationFn — WishlistButton đã biết isWishlisted hiện tại từ
// useWishlistStatus() rồi, tránh đọc trùng 2 nơi. onError rollback đúng data
// cũ đã snapshot, onSettled invalidate để đồng bộ lại với server.
export function useToggleWishlist(productId: string) {
  const queryClient = useQueryClient();
  const queryKey = wishlistStatusQueryKey(productId);

  return useMutation({
    mutationFn: (nextIsWishlisted: boolean) =>
      nextIsWishlisted
        ? wishlistService.addToWishlist(productId)
        : wishlistService.removeFromWishlist(productId),
    onMutate: async (nextIsWishlisted) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<WishlistStatus>(queryKey);
      queryClient.setQueryData<WishlistStatus>(queryKey, { isWishlisted: nextIsWishlisted });
      return { previous };
    },
    onError: (_err, _nextIsWishlisted, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
