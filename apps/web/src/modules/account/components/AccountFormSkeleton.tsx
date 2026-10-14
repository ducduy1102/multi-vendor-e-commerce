'use client';

import { useTranslations } from 'next-intl';

import { Skeleton } from '@/shared/components/ui/skeleton';

interface AccountFormSkeletonProps {
  // Số ô nhập (nhãn + ô) của form thật — để skeleton cùng chiều cao, không nhảy layout khi dữ liệu về.
  fieldCount: number;
}

// Skeleton của các form một cột trong khu /account (hồ sơ: 3 ô, đổi mật khẩu: 3 ô). Cùng độ rộng `max-w-lg`
// và cùng khoảng cách (gap-4, nhãn + ô gap-1.5) với form thật. Phần hình là trang trí (aria-hidden); vùng
// bọc `aria-busy` kèm một dòng `sr-only` đã dịch (rules/frontend.md mục 10).
export function AccountFormSkeleton({ fieldCount }: AccountFormSkeletonProps) {
  const tCommon = useTranslations('common');

  return (
    <div aria-busy="true" className="flex max-w-lg flex-col gap-4">
      <span className="sr-only">{tCommon('loading')}</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        {Array.from({ length: fieldCount }).map((_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-28 motion-reduce:animate-none" />
            <Skeleton className="h-8 w-full motion-reduce:animate-none" />
          </div>
        ))}
        <Skeleton className="h-8 w-32 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
