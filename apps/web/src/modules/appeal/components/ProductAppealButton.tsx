'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';

import { useCreateProductAppeal } from '../hooks/useCreateProductAppeal';
import { useDescribeAppealError } from '../hooks/useDescribeAppealError';
import { useProductAppeals } from '../hooks/useProductAppeals';
import { AppealDialog } from './AppealDialog';

interface ProductAppealButtonProps {
  shopId: string;
  productId: string;
  // Tên sản phẩm — chỉ để gắn vào `aria-label` ("Kháng nghị việc gỡ: Dao bấm"): trên một danh sách có nhiều nút giống hệt nhau, trình đọc
  // màn hình cần biết nút nào của sản phẩm nào.
  productName: string;
}

// Điều khiển GỌN của kháng nghị sản phẩm bị gỡ, đặt cạnh nhãn "Bị gỡ" ở danh sách sản phẩm của chủ shop (Week11.md 5.8). Hiện đúng một
// trong ba thứ theo điều SERVER báo: nút "Kháng nghị" (`canAppeal`), dòng "Đã gửi kháng nghị, chờ Admin xem xét" (kháng nghị gần nhất còn
// chờ), hoặc "Kháng nghị bị từ chối" — không có gì khác để hiện thì không vẽ gì. Lịch sử đầy đủ kèm phản hồi từ sàn nằm ở trang sửa
// (`ProductAppealSection`); cả hai dùng chung khoá cache nên gửi ở đâu thì nơi kia cập nhật theo. Nơi ghép (`app/.../seller/products`)
// chỉ dựng điều khiển này cho sản phẩm ĐANG bị gỡ — module `appeal` không biết trạng thái sản phẩm (không import `product`).
export function ProductAppealButton({ shopId, productId, productName }: ProductAppealButtonProps) {
  const t = useTranslations('appeal');
  const appealsQuery = useProductAppeals(shopId, productId);
  const createAppeal = useCreateProductAppeal(shopId, productId);
  const describeError = useDescribeAppealError('product');
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = appealsQuery.data;

  if (!data) {
    if (appealsQuery.isPending) {
      // Giữ đúng cỡ nút `size="sm"` để hàng không nhảy khi dữ liệu về.
      return <Skeleton aria-hidden="true" className="h-7 w-24 motion-reduce:animate-none" />;
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('loadError')}
        onClick={() => void appealsQuery.refetch()}
      >
        {t('retry')}
      </Button>
    );
  }

  // Mới nhất trước (BE sắp theo lần xử lý giảm dần): kháng nghị gần nhất là của lần gỡ hiện tại (nếu đã có).
  const latest = data.appeals[0];

  function openDialog() {
    setError(null);
    setIsOpen(true);
  }

  // Đang gửi thì không cho đóng (Esc/bấm nền) — hộp thoại tự đóng khi gửi xong.
  function handleOpenChange(open: boolean) {
    if (!open && createAppeal.isPending) return;
    setIsOpen(open);
  }

  async function handleSubmit(message: string): Promise<boolean> {
    setError(null);
    try {
      await createAppeal.mutateAsync(message);
    } catch (submitError) {
      setError(describeError(submitError));
      return false;
    }
    setIsOpen(false);
    return true;
  }

  return (
    <>
      {data.canAppeal ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('productListButtonLabel', { name: productName })}
          onClick={openDialog}
        >
          {t('productListButton')}
        </Button>
      ) : latest?.state === 'PENDING' ? (
        <span className="text-xs text-muted-foreground">{t('productListPending')}</span>
      ) : latest?.state === 'REJECTED' ? (
        <span className="text-xs text-muted-foreground">{t('productListRejected')}</span>
      ) : null}

      <AppealDialog
        kind="product"
        open={isOpen}
        onOpenChange={handleOpenChange}
        isPending={createAppeal.isPending}
        error={error}
        onSubmit={handleSubmit}
      />
    </>
  );
}
