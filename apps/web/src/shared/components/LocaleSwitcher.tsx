'use client';

import { useLocale } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { Button } from '@/shared/components/ui/button';

const LOCALE_LABELS: Record<string, string> = {
  vi: 'VI',
  en: 'EN',
};

// Chuyển đổi vi/en cho trang hiện tại. Link truyền `locale` tường minh (thay
// vì tự suy ra từ URL có/không prefix) — đúng cơ chế đã xác nhận ở Bước 4.5:
// muốn chuyển VỀ locale mặc định (vi) cũng phải link tường minh "/vi/...",
// next-intl mới tự rút gọn URL + cập nhật lại cookie NEXT_LOCALE đúng ý.
// Không tự định vị "fixed" — layout.tsx ghép component này cùng hàng với
// AuthStatusBar (góc trên bên phải), tự định vị ở đây sẽ đè lên nhau.
export function LocaleSwitcher() {
  const pathname = usePathname();
  const activeLocale = useLocale();

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-sm">
      {routing.locales.map((locale) => (
        <Button
          key={locale}
          type="button"
          variant={locale === activeLocale ? 'default' : 'ghost'}
          size="sm"
          nativeButton={false}
          render={<Link href={pathname} locale={locale} />}
        >
          {LOCALE_LABELS[locale]}
        </Button>
      ))}
    </div>
  );
}
