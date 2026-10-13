import { useFormatter, useTranslations } from 'next-intl';

import { StarRating } from '@/shared/components/StarRating';

interface ProductRatingLinkProps {
  avgRating: number;
  reviewCount: number;
}

// Dòng tóm tắt đánh giá ngay dưới tên sản phẩm ở trang chi tiết ("4,3 ★★★★☆ 12 đánh giá") — bấm nhảy tới khối
// đánh giá (`#reviews`, có `scroll-mt` chừa chỗ cho header dính). Chưa có đánh giá thì hiện chữ "Chưa có đánh
// giá" thay vì ẩn dòng: dòng LUÔN cao 20px (`h-5`) nên bố cục không nhảy giữa sản phẩm có/không có đánh giá và
// ProductDetailSkeleton khớp đúng một chiều cao. Số điểm hiển thị `aria-hidden` vì nhãn của `StarRating`
// ("4,3 trên 5 sao") đã đọc ra rồi. Dùng neo `<a href="#reviews">` thường (cùng trang, không điều hướng).
export function ProductRatingLink({ avgRating, reviewCount }: ProductRatingLinkProps) {
  const t = useTranslations('product');
  const format = useFormatter();

  if (reviewCount <= 0) {
    return (
      <p className="flex h-5 items-center text-sm text-muted-foreground">{t('detailNoReviews')}</p>
    );
  }

  return (
    <a
      href="#reviews"
      className="flex h-5 w-fit items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span aria-hidden="true" className="font-medium text-foreground">
        {format.number(avgRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
      </span>
      <StarRating value={avgRating} size="md" />
      <span>{t('detailReviewCount', { count: reviewCount })}</span>
    </a>
  );
}
