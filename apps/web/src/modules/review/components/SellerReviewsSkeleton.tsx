import { Skeleton } from '@/shared/components/ui/skeleton';

import { SELLER_REVIEWS_CARD_CLASS } from './seller-reviews.constants';

const SKELETON_CLASS = 'motion-reduce:animate-none';

interface SellerReviewsSkeletonProps {
  count?: number;
}

// Khớp bố cục danh sách thật (cùng khung viền bo, cùng nhịp dòng: dòng sản phẩm, hàng sao, nội dung, nút trả lời)
// để không nhảy layout khi dữ liệu về. Chỉ mang tính trang trí (aria-hidden) — vùng bọc ở Container có aria-busy
// + dòng sr-only.
export function SellerReviewsSkeleton({ count = 3 }: SellerReviewsSkeletonProps) {
  return (
    <div aria-hidden="true" className={SELLER_REVIEWS_CARD_CLASS}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-1 gap-2 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0"
        >
          <Skeleton className={`h-5 w-48 ${SKELETON_CLASS}`} />
          <Skeleton className={`h-4 w-40 ${SKELETON_CLASS}`} />
          <Skeleton className={`h-5 w-full ${SKELETON_CLASS}`} />
          <Skeleton className={`h-5 w-2/3 ${SKELETON_CLASS}`} />
          <Skeleton className={`h-9 w-24 ${SKELETON_CLASS}`} />
        </div>
      ))}
    </div>
  );
}
