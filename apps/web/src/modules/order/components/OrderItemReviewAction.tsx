'use client';

import { useTranslations } from 'next-intl';

import { StarRating } from '@/shared/components/StarRating';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

import type { OrderDetailItem } from '../types';

interface OrderItemReviewActionProps {
  // Hai cờ do BE tính (orderDetailItemSchema) — FE KHÔNG tự suy luật đánh giá được (đơn COMPLETED, trong cửa
  // sổ, chưa đánh giá, không phải shop của chính mình...). `review` là đánh giá của chính người mua (hoặc null).
  canReview: boolean;
  review: OrderDetailItem['review'];
  onWrite: () => void;
  onEdit: () => void;
}

// Dải hành động đánh giá dưới một dòng hàng của chi tiết đơn (component thuần, nơi gọi nối hộp thoại):
//   - đã có đánh giá  → "Đã đánh giá" + sao đã chấm, kèm nút "Sửa" khi còn sửa được (đúng một lần, `canEdit`);
//                        hết lần sửa vẫn hiện "Đã đánh giá ★n" (không nút) để người mua biết mình đã chấm;
//                        Admin đã ẩn (`isHidden`, Week11.md 5.5) → thêm nhãn "Đã bị ẩn" (tác giả vẫn thấy bản của mình, người khác
//                        thì không), BE tắt `canEdit`, và HIỆN lý do của Admin bằng chữ ngay bên dưới (không chỉ tooltip: tác giả
//                        cần đọc được trên cả cảm ứng) — lý do là văn bản tự do nên `[overflow-wrap:anywhere]` và chỉ đi vào tham số dịch;
//   - chưa, được phép → nút "Viết đánh giá";
//   - còn lại         → không gì cả (đơn chưa hoàn tất, hết hạn đánh giá...). Trả `null` nên dải của dòng hàng ẩn.
// `review` được xét TRƯỚC `canReview`: khi đã đánh giá thì BE tắt `canReview`, nhưng luôn có `review`.
// Nút cao tối thiểu 36px (`min-h-9`) để dễ bấm trên mobile, cùng cỡ với link "Xem chi tiết" của thẻ đơn.
export function OrderItemReviewAction({
  canReview,
  review,
  onWrite,
  onEdit,
}: OrderItemReviewActionProps) {
  const t = useTranslations('review');

  if (review) {
    return (
      <div className="grid grid-cols-1 gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{t('reviewedLabel')}</span>
          <StarRating value={review.rating} size="sm" />
          {review.isHidden ? (
            <Badge variant="outline" title={t('hiddenHint')}>
              {t('hiddenLabel')}
            </Badge>
          ) : null}
          {review.canEdit ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto min-h-9 px-2"
              onClick={onEdit}
            >
              {t('editButton')}
            </Button>
          ) : null}
        </div>
        {review.isHidden ? (
          <p className="text-xs [overflow-wrap:anywhere] whitespace-pre-line text-foreground">
            {review.hiddenReason
              ? t('hiddenReasonLine', { reason: review.hiddenReason })
              : t('hiddenHint')}
          </p>
        ) : null}
      </div>
    );
  }

  if (canReview) {
    return (
      <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={onWrite}>
        {t('writeButton')}
      </Button>
    );
  }

  return null;
}
