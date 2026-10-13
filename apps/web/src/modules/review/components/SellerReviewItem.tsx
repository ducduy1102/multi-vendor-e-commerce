'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Link } from '@/i18n/navigation';
import { Button } from '@/shared/components/ui/button';

import { useDescribeReviewError } from '../hooks/useDescribeReviewError';
import { useReplyToReview } from '../hooks/useReplyToReview';
import type { SellerReview } from '../types';
import { ReviewItem } from './ReviewItem';
import { ReviewReplyForm } from './ReviewReplyForm';

interface SellerReviewItemProps {
  review: SellerReview;
  // shopId do page.tsx (composition root) truyền xuống qua Container — module review không tự biết "shop của tôi".
  shopId: string;
}

// Một đánh giá trong danh sách của shop: dựng trên ReviewItem (cùng cách hiển thị sao/tên che/ngày/nội dung/khối
// phản hồi như trang sản phẩm) + dòng sản phẩm được đánh giá ở trên (link tới trang sửa sản phẩm của shop — luôn mở
// được, kể cả sản phẩm đã lưu trữ mà trang công khai trả 404) + khu trả lời ở dưới. Chưa trả lời: nút "Trả lời";
// đã trả lời: nút "Sửa câu trả lời" (BE ghi đè, không xoá được). Form mở tại chỗ, không hộp thoại — nhìn được
// đánh giá ngay phía trên khi viết. Dùng `mutateAsync` chứ không callback của `mutate`: hook làm mới danh sách khi
// xong, ở tab "Chưa trả lời" đánh giá vừa trả lời biến khỏi danh sách (component unmount) nên callback của `mutate`
// sẽ không chạy và toast thành công không hiện.
export function SellerReviewItem({ review, shopId }: SellerReviewItemProps) {
  const t = useTranslations('review');
  const describeError = useDescribeReviewError();
  const replyMutation = useReplyToReview(shopId);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasReply = review.sellerReply !== null;

  function openForm() {
    setErrorMessage(null);
    setIsFormOpen(true);
  }

  async function handleSubmit(reply: string) {
    setErrorMessage(null);
    try {
      await replyMutation.mutateAsync({ reviewId: review.id, reply });
      toast.success(hasReply ? t('replySuccessEdit') : t('replySuccessCreate'));
      setIsFormOpen(false);
    } catch (error) {
      setErrorMessage(describeError(error));
    }
  }

  return (
    <ReviewItem
      review={review}
      header={
        <Link
          href={`/seller/products/${review.product.id}/edit`}
          className="w-fit max-w-full text-sm font-medium break-words text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {review.product.name}
        </Link>
      }
      footer={
        isFormOpen ? (
          <ReviewReplyForm
            initialReply={review.sellerReply ?? ''}
            isPending={replyMutation.isPending}
            errorMessage={errorMessage}
            onSubmit={(reply) => void handleSubmit(reply)}
            onCancel={() => setIsFormOpen(false)}
          />
        ) : (
          <div>
            <Button type="button" variant="outline" className="min-h-9" onClick={openForm}>
              {hasReply ? t('replyEditButton') : t('replyButton')}
            </Button>
          </div>
        )
      }
    />
  );
}
