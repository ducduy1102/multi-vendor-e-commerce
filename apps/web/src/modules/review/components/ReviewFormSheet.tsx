'use client';

import { useTranslations } from 'next-intl';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet';

import type { ReviewFormInput } from '../types';
import { ReviewForm } from './ReviewForm';

export interface ReviewFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  // Tên sản phẩm đang đánh giá (snapshot lúc đặt) — cho người dùng biết đang viết cho dòng hàng nào.
  productName: string;
  initialValues?: ReviewFormInput;
  isSubmitting: boolean;
  errorMessage?: string | null;
  onSubmit: (values: ReviewFormInput) => void;
}

// Ngăn kéo chứa ReviewForm (Sheet là primitive đã duyệt). `ReviewForm` nằm TRONG `SheetContent` nên chỉ được
// mount khi ngăn kéo mở: mỗi lần mở là một form mới (không giữ nhận xét dở của dòng hàng khác). Component
// thuần — trạng thái mở/đóng, mutation và chặn đóng khi đang gửi do nơi dùng quyết định. Cạnh phải rộng
// toàn màn hình trên mobile (`data-[side=right]:w-full`, ghi đè 3/4 mặc định để chừa đủ chỗ cho hàng 5 sao)
// và tối đa `md` từ sm.
export function ReviewFormSheet({
  open,
  onOpenChange,
  mode,
  productName,
  initialValues,
  isSubmitting,
  errorMessage,
  onSubmit,
}: ReviewFormSheetProps) {
  const t = useTranslations('review');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle>{mode === 'edit' ? t('formTitleEdit') : t('formTitleCreate')}</SheetTitle>
          <SheetDescription>
            {mode === 'edit' ? t('formDescriptionEdit') : t('formDescriptionCreate')}
          </SheetDescription>
          <p className="mt-1 line-clamp-2 text-sm font-medium break-words text-foreground">
            {productName}
          </p>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <ReviewForm
            mode={mode}
            initialValues={initialValues}
            isSubmitting={isSubmitting}
            errorMessage={errorMessage}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
