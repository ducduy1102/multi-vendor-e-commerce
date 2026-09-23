'use client';

import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuthStore } from '@/modules/auth';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { useToggleWishlist } from '../hooks/useToggleWishlist';
import { useWishlistStatus } from '../hooks/useWishlistStatus';

interface WishlistButtonProps {
  productId: string;
}

// Week5.md Bước 3.4 — gọi GET /wishlist/:productId/status lúc mount (qua
// useWishlistStatus, chỉ khi đã đăng nhập) để biết trạng thái ban đầu (1.18),
// toggle qua useToggleWishlist (optimistic). Chưa đăng nhập -> ẨN HẲN nút
// (đã chốt lúc code, không thêm Tooltip mới chỉ để hiện gợi ý "đăng nhập để
// lưu" — Tooltip chưa có trong danh sách primitive đã duyệt ở
// rules/frontend.md mục 10).
export function WishlistButton({ productId }: WishlistButtonProps) {
  const t = useTranslations('wishlist');
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);
  const isLoggedIn = Boolean(user);

  const statusQuery = useWishlistStatus(productId, isLoggedIn);
  const toggleMutation = useToggleWishlist(productId);

  // Chưa chắc chắn đã đăng nhập hay chưa (đang hydrate) -> chưa hiện gì,
  // tránh nháy hiện nút rồi biến mất ngay sau đó (đúng convention isHydrating
  // đã dùng ở Header/BecomeSellerFormContainer).
  if (isHydrating || !isLoggedIn) {
    return null;
  }

  const isWishlisted = statusQuery.data?.isWishlisted ?? false;

  function handleClick() {
    toggleMutation.mutate(!isWishlisted);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-pressed={isWishlisted}
      aria-label={isWishlisted ? t('removeLabel') : t('addLabel')}
      disabled={statusQuery.isPending || toggleMutation.isPending}
      onClick={handleClick}
    >
      <Heart className={cn('size-4', isWishlisted && 'fill-primary text-primary')} />
    </Button>
  );
}
