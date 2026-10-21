import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/lib/utils';

import { SKELETON_CLASS } from './chat-layout.constants';

// Khung xương của khung tin: vài bong bóng xen kẽ hai phía, cùng cột `grid-cols-1` và `max-w-[85%]` với MessageBubble
// để không nhảy layout khi tin về. Chỉ trang trí (aria-hidden): vùng bọc có aria-busy + dòng sr-only đã dịch.
const ROWS: { side: 'left' | 'right'; width: string }[] = [
  { side: 'left', width: 'w-3/5' },
  { side: 'right', width: 'w-2/5' },
  { side: 'left', width: 'w-1/2' },
  { side: 'right', width: 'w-3/5' },
  { side: 'left', width: 'w-2/5' },
];

export function MessageListSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3 px-3 py-3">
      {ROWS.map((row, index) => (
        <div
          key={index}
          className={cn('flex min-w-0', row.side === 'right' ? 'justify-end' : 'justify-start')}
        >
          <Skeleton className={cn('h-9 max-w-[85%] rounded-2xl', row.width, SKELETON_CLASS)} />
        </div>
      ))}
    </div>
  );
}
