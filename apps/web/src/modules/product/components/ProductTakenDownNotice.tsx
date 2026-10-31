import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/shared/components/ui/alert';
import { buttonVariants } from '@/shared/components/ui/button';

interface ProductTakenDownNoticeProps {
  productName: string;
  // Lý do Admin đã nhập khi gỡ (luôn có khi sản phẩm ở TAKEN_DOWN — CHECK ở DB).
  reason: string | null;
  // Mục kháng nghị (Week11.md 5.8) do page.tsx ghép vào: modules/product không được import modules/appeal (rules/general.md mục 1). Slot là
  // ReactNode tĩnh (không phải hàm render) vì nó đi qua ranh giới Server → Client Component.
  appealSlot?: ReactNode;
}

// Thay cho form sửa khi sàn đã gỡ sản phẩm vi phạm (Week11.md 5.7): chủ shop không sửa, xuất bản hay lưu trữ được (BE trả 409
// PRODUCT_TAKEN_DOWN cho mọi thao tác), nên KHÔNG dựng form — không có nút nào để bấm rồi mới bị từ chối. Chỉ hiện điều chủ shop cần: tên
// sản phẩm, lý do từ sàn và đường về danh sách. Lý do là văn bản người khác nhập: giữ xuống dòng, bẻ chuỗi dài không dấu cách
// (`[overflow-wrap:anywhere]` — `break-words` không thu nhỏ min-content, rules/frontend.md mục 5).
export function ProductTakenDownNotice({
  productName,
  reason,
  appealSlot,
}: ProductTakenDownNoticeProps) {
  const t = useTranslations('product');

  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" title={productName}>
        {productName}
      </p>
      <Alert variant="destructive">
        <AlertTitle>{t('takenDownTitle')}</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          {reason ? (
            <span className="font-medium whitespace-pre-line [overflow-wrap:anywhere]">
              {t('takenDownReason', { reason })}
            </span>
          ) : null}
          {/* Câu hướng dẫn dùng màu chữ thường (không đỏ cả đoạn): chỉ tiêu đề và lý do mang tông cảnh báo, phần còn lại dễ đọc hơn. */}
          <span className="text-foreground">{t('takenDownBody')}</span>
        </AlertDescription>
      </Alert>
      {/* Cha dùng `items-start` nên con co theo nội dung; bọc `w-full` để khung kháng nghị rộng bằng khung cảnh báo phía trên. */}
      {appealSlot ? <div className="w-full">{appealSlot}</div> : null}
      <Link href="/seller/products" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
        {t('takenDownBack')}
      </Link>
    </div>
  );
}
