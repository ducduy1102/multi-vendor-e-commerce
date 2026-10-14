'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/shared/lib/utils';

// Thanh điều hướng con của khu /account — dạng link (không có primitive Tabs được duyệt, Week9.md 1.11).
// Mỗi mục là một route thật nên mở tab mới/đánh dấu trang đều dùng được. `exact` cho mục gốc: "/account"
// là tiền tố của mọi mục còn lại nên phải so khớp tuyệt đối, nếu không nó luôn sáng.
const ACCOUNT_NAV_ITEMS = [
  { href: '/account', labelKey: 'navProfile', exact: true },
  { href: '/account/addresses', labelKey: 'navAddresses', exact: false },
  { href: '/account/password', labelKey: 'navPassword', exact: false },
] as const;

export function AccountNav() {
  const t = useTranslations('account');
  const pathname = usePathname();

  return (
    <nav aria-label={t('navLabel')} className="flex flex-wrap gap-1 border-b border-border pb-2">
      {ACCOUNT_NAV_ITEMS.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
