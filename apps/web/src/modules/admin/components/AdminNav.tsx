'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import type { LooseTranslator } from '@/shared/hooks/useValidationMessage';
import { cn } from '@/shared/lib/utils';

import {
  ADMIN_NAV_ITEMS,
  formatAdminNavCount,
  isAdminNavItemActive,
} from '../admin-overview-display';
import { useAdminOverview } from '../hooks/useAdminOverview';

// Điều hướng của khu /admin (Week11.md 2.6, phương án A của wireframe): MỘT phần tử `nav` đổi dáng theo khổ màn thay vì
// hai bản JSX ẩn/hiện — dưới `lg` là thanh tab ngang cuộn được (gạch chân brand ở mục đang chọn), từ `lg` là sidebar
// dọc 224px dính dưới Header (nền secondary + icon brand ở mục đang chọn). Nền `--muted` gần trùng nền trang nên tab
// ngang dùng gạch chân thay vì nền; hover (`muted/50`) luôn nhạt hơn mục đang chọn để rê qua mục khác không giống "vừa
// chọn". Số việc chờ lấy từ cùng query với trang tổng quan (một lần gọi API); chưa có số (đang tải / lỗi) thì không
// hiện huy hiệu thay vì hiện số 0 sai.
const NAV_CLASS =
  '-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:sticky lg:top-20 lg:mx-0 lg:w-56 lg:shrink-0 lg:flex-col lg:self-start lg:overflow-visible lg:border-b-0 lg:p-0';

const LINK_CLASS =
  'relative inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 lg:h-10 lg:w-full lg:gap-2.5 lg:rounded-xl lg:font-normal';
const LINK_IDLE_CLASS =
  'text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:text-foreground/70';
const LINK_ACTIVE_CLASS =
  'text-foreground after:absolute after:inset-x-3 after:-bottom-2 after:h-0.5 after:rounded-full after:bg-primary lg:bg-secondary lg:font-medium lg:after:hidden lg:[&_svg]:text-primary';

export function AdminNav() {
  const t = useTranslations('admin');
  const tDynamic = t as unknown as LooseTranslator;
  const pathname = usePathname();
  const overview = useAdminOverview().data;

  return (
    <nav aria-label={t('navLabel')} className={NAV_CLASS}>
      {ADMIN_NAV_ITEMS.map((item) => {
        const isActive = isAdminNavItemActive(item, pathname);
        const count = overview ? item.count(overview) : null;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(LINK_CLASS, isActive ? LINK_ACTIVE_CLASS : LINK_IDLE_CLASS)}
          >
            <Icon className="hidden size-4 shrink-0 lg:block" aria-hidden="true" />
            <span className="lg:truncate">{tDynamic(item.labelKey)}</span>
            {count ? (
              <span
                className={cn(
                  'text-xs tabular-nums lg:ml-auto lg:shrink-0',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {formatAdminNavCount(count)}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
