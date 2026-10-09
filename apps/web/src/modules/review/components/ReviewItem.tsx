import { useFormatter, useTranslations } from 'next-intl';

import { StarRating } from '@/shared/components/StarRating';
import type { Review } from '../types';

// Ngày đánh giá hiển thị theo múi giờ Việt Nam, cố định: khối đánh giá render ở server nên không thể dùng múi
// giờ trình duyệt như các màn client (useFormatOrderDate) — đánh giá lúc 23:30 giờ Việt Nam sẽ hiện nhầm sang
// ngày hôm sau nếu server chạy UTC. Sàn bán cho thị trường Việt Nam nên một múi giờ là đủ.
const REVIEW_DATE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

interface ReviewItemProps {
  review: Review;
}

// Một đánh giá công khai: sao, tên đã che (BE che, không bao giờ có userId/email), ngày, nhãn "Đã chỉnh sửa",
// nội dung và khối trả lời của shop. Nội dung do người dùng nhập (tối đa 1000 ký tự, có thể không có dấu cách)
// nên mọi khối chữ dùng `break-words`, lưới khai cột tường minh `grid-cols-1` (= minmax(0,1fr)) và phần tử flex
// có `min-w-0` — chuỗi dài không đẩy trang rộng ra (rules/frontend.md mục 5). Component thuần, không gọi API.
export function ReviewItem({ review }: ReviewItemProps) {
  const t = useTranslations('review');
  const format = useFormatter();
  const formatDate = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeZone: REVIEW_DATE_TIME_ZONE });

  return (
    <li className="grid grid-cols-1 gap-2 border-b border-border py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StarRating value={review.rating} size="sm" />
        <span className="min-w-0 text-sm font-medium break-words text-foreground">
          {review.reviewerName}
        </span>
        <time dateTime={review.createdAt} className="text-xs text-muted-foreground">
          {formatDate(review.createdAt)}
        </time>
        {review.editedAt ? (
          <span className="text-xs text-muted-foreground">· {t('edited')}</span>
        ) : null}
      </div>

      {review.comment ? (
        <p className="text-sm break-words whitespace-pre-line text-foreground">{review.comment}</p>
      ) : null}

      {review.sellerReply ? (
        <div className="grid grid-cols-1 gap-1 rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium text-foreground">{t('sellerReplyLabel')}</p>
          <p className="break-words whitespace-pre-line text-foreground">{review.sellerReply}</p>
          {review.sellerRepliedAt ? (
            <time dateTime={review.sellerRepliedAt} className="text-xs text-muted-foreground">
              {formatDate(review.sellerRepliedAt)}
            </time>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
