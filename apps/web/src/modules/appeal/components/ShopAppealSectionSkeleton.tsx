import { Skeleton } from '@/shared/components/ui/skeleton';

import { APPEAL_SECTION_CLASS } from './appeal-section.constants';

const SKELETON_CLASS = 'motion-reduce:animate-none';

// Khớp bố cục mục kháng nghị thật (cùng khung, tiêu đề, nút và một thẻ lịch sử) để không nhảy layout khi dữ liệu về. Chỉ mang
// tính trang trí (aria-hidden) — vùng bọc ở Container có aria-busy + dòng sr-only.
export function ShopAppealSectionSkeleton() {
  return (
    <div aria-hidden="true" className={APPEAL_SECTION_CLASS}>
      <Skeleton className={`h-5 w-24 ${SKELETON_CLASS}`} />
      <Skeleton className={`h-9 w-36 ${SKELETON_CLASS}`} />
      <Skeleton className={`h-20 w-full ${SKELETON_CLASS}`} />
    </div>
  );
}
