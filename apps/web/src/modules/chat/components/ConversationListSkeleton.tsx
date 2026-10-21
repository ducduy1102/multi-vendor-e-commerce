import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import { AVATAR_CLASS, CONVERSATION_ROW_CLASS, SKELETON_CLASS } from './chat-layout.constants';

interface ConversationListSkeletonProps {
  count?: number;
}

// Khớp bố cục ConversationListItem (cùng class dòng + avatar) để không nhảy layout khi dữ liệu về. Chỉ trang trí
// (aria-hidden): vùng bọc ở ConversationList có aria-busy + dòng sr-only đã dịch.
export function ConversationListSkeleton({ count = 6 }: ConversationListSkeletonProps) {
  return (
    <ul aria-hidden="true" className="divide-y divide-border">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className={cn(CONVERSATION_ROW_CLASS, 'min-h-16')}>
          <Skeleton className={cn(AVATAR_CLASS, SKELETON_CLASS)} />
          <span className="flex min-w-0 flex-col gap-1.5">
            <Skeleton className={cn('h-4 w-2/5', SKELETON_CLASS)} />
            <Skeleton className={cn('h-3.5 w-3/4', SKELETON_CLASS)} />
          </span>
          <Skeleton className={cn('h-3 w-8', SKELETON_CLASS)} />
        </li>
      ))}
    </ul>
  );
}
