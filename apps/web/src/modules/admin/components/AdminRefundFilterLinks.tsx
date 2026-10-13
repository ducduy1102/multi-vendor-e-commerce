'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import { buildAdminRefundsHref, type AdminRefundTab } from '../admin-refunds-href';

interface AdminRefundFilterLinksProps {
  tab: AdminRefundTab;
  // Bộ lọc con hợp lệ của tab (theo thứ tự hiện) + nhãn từng bộ lọc; giá trị đang chọn.
  options: readonly string[];
  labelKeys: Readonly<Record<string, string>>;
  activeStatus: string;
  // Nhãn `aria-label` của cụm lọc.
  ariaLabelKey: string;
}

const CHIP_CLASS =
  'inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

// Bộ lọc con của một tab (vd "Chờ sàn xử lý" / "Chờ shop (ghi đè)"): hàng nút bo tròn dạng link đổi `?status=` trên
// URL — không state cục bộ, chia sẻ/refresh/nút Back đều giữ đúng bộ lọc; đổi bộ lọc luôn về trang 1 và GIỮ tab.
// Tự xuống dòng ở màn hẹp. Component THUẦN (chỉ link).
export function AdminRefundFilterLinks({
  tab,
  options,
  labelKeys,
  activeStatus,
  ariaLabelKey,
}: AdminRefundFilterLinksProps) {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;

  return (
    <nav aria-label={tDynamic(ariaLabelKey)}>
      <ul className="flex flex-wrap gap-2">
        {options.map((status) => {
          const isActive = status === activeStatus;
          return (
            <li key={status}>
              <Link
                href={buildAdminRefundsHref({ tab, status })}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  CHIP_CLASS,
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-foreground hover:border-primary hover:text-primary',
                )}
              >
                {tDynamic(labelKeys[status])}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
