'use client';

import { useTranslations } from 'next-intl';

import { Skeleton } from '@/shared/components/ui/skeleton';

// Skeleton của sổ địa chỉ: cùng khung `max-w-2xl`, cùng hàng tiêu đề + nút và cùng kích thước thẻ địa chỉ
// (viền, p-3, hai dòng chữ + hàng nút) với AddressBookContainer thật. Phần hình là trang trí (aria-hidden),
// vùng bọc `aria-busy` kèm dòng `sr-only` đã dịch (rules/frontend.md mục 10).
export function AddressBookSkeleton() {
  const tCommon = useTranslations('common');

  return (
    <div aria-busy="true" className="flex max-w-2xl flex-col gap-4">
      <span className="sr-only">{tCommon('loading')}</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-6 w-32 motion-reduce:animate-none" />
          <Skeleton className="h-8 w-36 motion-reduce:animate-none" />
        </div>
        <ul className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <li
              key={index}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-48 motion-reduce:animate-none" />
                <Skeleton className="h-4 w-full max-w-xs motion-reduce:animate-none" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-7 w-16 motion-reduce:animate-none" />
                <Skeleton className="h-7 w-14 motion-reduce:animate-none" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
