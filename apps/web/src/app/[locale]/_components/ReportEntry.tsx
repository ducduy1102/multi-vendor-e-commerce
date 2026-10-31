'use client';

import type { ReportTargetType } from '@ecommerce/types';
import { Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { lazy, Suspense } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { useAuthStore } from '@/modules/auth';
import { ChunkFailureBoundary } from '@/shared/components/ChunkFailureBoundary';
import { buttonVariants } from '@/shared/components/ui/button';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

// `ReportButton` nạp ĐỘNG: khách vãng lai không bao giờ báo cáo được (BE đòi đăng nhập), nên mã hộp thoại / form / hook báo cáo không
// được nằm trong chunk của các trang công khai (trang sản phẩm, trang shop) mà họ vào. Chunk chỉ được yêu cầu khi `user !== null`;
// `shared/lib/guest-bundle.test.ts` giữ điều đó. Chunk lỗi (mạng chập chờn) chỉ làm mất nút, không làm `error.tsx` thay cả trang.
const ReportButtonImpl = lazy(() =>
  import('@/modules/report').then((module) => ({ default: module.ReportButton })),
);

interface ReportEntryProps {
  targetType: ReportTargetType;
  targetId: string;
  variant?: 'ghost' | 'outline';
  className?: string;
}

// Điểm vào "Báo cáo" cho mọi trang người mua (Week11.md 5.6) — COMPOSITION ROOT: module `report` là lá, không biết người xem đã đăng
// nhập chưa (`modules/auth`), nên nơi ghép quyết định ba trạng thái:
//  - chờ AuthHydrator hỏi xong /auth/me: chỗ giữ bằng skeleton đúng cỡ nút (không nháy "đăng nhập để báo cáo" rồi đổi thành nút thật);
//  - khách vãng lai: LINK `/login?next=<trang hiện tại>` — đăng nhập xong quay lại đúng trang để bấm tiếp;
//  - đã đăng nhập: nút thật (mã nạp động). Báo cáo nội dung của chính mình do BE chặn (409 REPORT_OWN_CONTENT) và hộp thoại hiện câu
//    giải thích — trang công khai không có thông tin để FE tự biết "đây là của mình" ở mọi loại đối tượng.
export function ReportEntry({
  targetType,
  targetId,
  variant = 'ghost',
  className,
}: ReportEntryProps) {
  const t = useTranslations('report');
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isHydrating = useAuthStore((state) => state.isHydrating);

  if (isHydrating) {
    return <Skeleton aria-hidden="true" className="h-8 w-20 motion-reduce:animate-none" />;
  }

  if (user === null) {
    return (
      <Link
        href={{ pathname: '/login', query: { next: pathname } }}
        className={buttonVariants({ variant, size: 'sm', className: cn('min-h-9', className) })}
      >
        <Flag aria-hidden="true" data-icon="inline-start" />
        {t('buttonLabel')}
      </Link>
    );
  }

  return (
    <ChunkFailureBoundary>
      <Suspense
        fallback={<Skeleton aria-hidden="true" className="h-8 w-20 motion-reduce:animate-none" />}
      >
        <ReportButtonImpl
          targetType={targetType}
          targetId={targetId}
          variant={variant}
          className={className}
        />
      </Suspense>
    </ChunkFailureBoundary>
  );
}
