import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  useCreateReview,
  useDescribeReviewError,
  useUpdateReview,
  type ReviewFormInput,
  type ReviewFormSheetProps,
} from '@/modules/review';

import type { OrderDetailItem } from '../types';
import { orderQueryKey } from './order-query-keys';

// Chỉ cần 3 field của dòng hàng — đủ để mở form và (khi sửa) điền sẵn đánh giá cũ.
export type ReviewTargetItem = Pick<OrderDetailItem, 'productId' | 'productName' | 'review'>;

// Luồng viết/sửa đánh giá từ chi tiết đơn của NGƯỜI MUA: dòng hàng đang được đánh giá, trạng thái ngăn kéo,
// gọi mutation của module review, dịch lỗi theo `code`, chặn đóng khi đang gửi. Chỉ chứa luồng — hiển thị nằm
// ở ReviewFormSheet/OrderItemReviewAction (component thuần). Module review không được import module order
// nên key cache chi tiết đơn (`orderQueryKey`) được làm mới Ở ĐÂY, qua callback `onSettled` của hook ghi.
export function useOrderItemReviewFlow(orderId: string) {
  const t = useTranslations('review');
  const queryClient = useQueryClient();
  const describeError = useDescribeReviewError();

  // Cờ `canReview`/`review` của mọi dòng nằm trong cache chi tiết đơn. Làm mới cả khi LỖI (409 nghĩa là cờ đang
  // hiển thị đã cũ) và TRẢ về Promise để mutation đợi làm mới xong mới kết thúc — nút ở dòng hàng đã đổi trước
  // khi ngăn kéo đóng, không có khoảng hở nút "Viết đánh giá" cũ còn hiện (note-nextjs.md #36).
  const refreshOrder = () => queryClient.invalidateQueries({ queryKey: orderQueryKey(orderId) });
  const createReview = useCreateReview({ onSettled: refreshOrder });
  const updateReview = useUpdateReview({ onSettled: refreshOrder });

  // Giữ nguyên dòng hàng cả sau khi đóng để nội dung ngăn kéo không đổi giữa chừng lúc chạy hiệu ứng đóng.
  const [target, setTarget] = useState<ReviewTargetItem | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isSubmitting = createReview.isPending || updateReview.isPending;

  function open(next: ReviewTargetItem) {
    setSubmitError(null);
    setTarget(next);
    setIsOpen(true);
  }

  // Đang gửi thì không cho đóng (Esc/bấm nền/nút X) — ngăn kéo tự đóng khi yêu cầu thành công.
  function onOpenChange(nextOpen: boolean) {
    if (!nextOpen && isSubmitting) return;
    setIsOpen(nextOpen);
  }

  async function submit(values: ReviewFormInput) {
    if (!target) return;
    setSubmitError(null);
    try {
      if (target.review) {
        await updateReview.mutateAsync({ reviewId: target.review.id, ...values });
        toast.success(t('submitSuccessEdit'));
      } else {
        await createReview.mutateAsync({ orderId, productId: target.productId, ...values });
        toast.success(t('submitSuccessCreate'));
      }
      setIsOpen(false);
    } catch (error) {
      // Giữ ngăn kéo mở và giữ nguyên những gì người dùng đã nhập; câu lỗi đã dịch hiện ở đầu form.
      setSubmitError(describeError(error));
    }
  }

  // Đánh giá cũ đưa vào form qua `initialValues` (dùng option `values` của react-hook-form). Memo theo dòng hàng
  // để object không đổi mỗi lần render.
  const initialValues = useMemo<ReviewFormInput | undefined>(
    () =>
      target?.review
        ? { rating: target.review.rating, comment: target.review.comment ?? undefined }
        : undefined,
    [target],
  );

  const sheet: ReviewFormSheetProps = {
    open: isOpen,
    onOpenChange,
    mode: target?.review ? 'edit' : 'create',
    productName: target?.productName ?? '',
    initialValues,
    isSubmitting,
    errorMessage: submitError,
    onSubmit: (values) => void submit(values),
  };

  return {
    openWrite: (item: Pick<ReviewTargetItem, 'productId' | 'productName'>) =>
      open({ productId: item.productId, productName: item.productName, review: null }),
    openEdit: (item: ReviewTargetItem) => open(item),
    sheet,
  };
}
