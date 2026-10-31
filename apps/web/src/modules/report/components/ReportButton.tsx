'use client';

import { Check, Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

import { useCreateReport } from '../hooks/useCreateReport';
import { useDescribeReportError } from '../hooks/useDescribeReportError';
import type { ReportFormInput } from '../schemas/report.schema';
import type { ReportTargetType } from '../types';
import { ReportDialog } from './ReportDialog';

interface ReportButtonProps {
  targetType: ReportTargetType;
  targetId: string;
  variant?: 'ghost' | 'outline';
  size?: 'sm' | 'default';
  className?: string;
}

// Nút "Báo cáo" + hộp thoại + mutation, dùng được cho cả bốn loại đối tượng (đánh giá, hội thoại, shop, sản phẩm). Module `report` là
// LÁ: nút KHÔNG biết người xem đã đăng nhập chưa hay có phải chủ nội dung không — nơi ghép (app/[locale]/_components/ReportEntry) chỉ
// dựng nút này cho người đã đăng nhập, còn BE chặn báo cáo nội dung của chính mình bằng 409 REPORT_OWN_CONTENT (người dùng thấy câu
// giải thích ngay trong hộp thoại). Gửi xong: đóng hộp thoại, toast, và nút đổi thành nhãn "Đã gửi báo cáo" (chỉ trong lần hiển thị
// này — tải lại trang thì BE vẫn chặn báo cáo trùng bằng 409 REPORT_ALREADY_OPEN).
export function ReportButton({
  targetType,
  targetId,
  variant = 'ghost',
  size = 'sm',
  className,
}: ReportButtonProps) {
  const t = useTranslations('report');
  const mutation = useCreateReport();
  const describeError = useDescribeReportError();
  const [isOpen, setIsOpen] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(input: ReportFormInput): Promise<boolean> {
    setError(null);
    try {
      await mutation.mutateAsync(input);
    } catch (submitError) {
      setError(describeError(submitError));
      return false;
    }
    setIsSent(true);
    setIsOpen(false);
    toast.success(t('sentSuccess'));
    return true;
  }

  if (isSent) {
    return (
      <span
        role="status"
        className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs text-muted-foreground"
      >
        <Check aria-hidden="true" className="size-3.5" />
        {t('sent')}
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        // Cao tối thiểu 36px (`min-h-9`) cho vùng bấm đủ lớn trên mobile — nút `sm` mặc định chỉ cao 28px.
        className={cn('min-h-9', className)}
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
      >
        <Flag aria-hidden="true" data-icon="inline-start" />
        {t('buttonLabel')}
      </Button>
      <ReportDialog
        open={isOpen}
        // Đang gửi thì không cho đóng bằng Esc / bấm nền: đóng giữa chừng làm mất kết quả của yêu cầu đang bay.
        onOpenChange={(next) => {
          if (!mutation.isPending) setIsOpen(next);
        }}
        targetType={targetType}
        targetId={targetId}
        isPending={mutation.isPending}
        error={error}
        onSubmit={handleSubmit}
      />
    </>
  );
}
