'use client';

import { useLocale } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { Button } from '@/shared/components/ui/button';

const LOCALE_LABELS: Record<string, string> = {
  vi: 'VI',
  en: 'EN',
};

interface LocaleSwitcherProps {
  // Query string cần giữ khi đổi ngôn ngữ. `usePathname()` chỉ trả đường dẫn nên mặc định query bị rơi — với
  // trang xác thực thì mất đúng thứ quan trọng nhất (`?next=` đích quay lại sau đăng nhập, `?token=` của link
  // đặt lại mật khẩu). Trang Server Component truyền xuống những giá trị nó đã đọc/kiểm từ `searchParams`
  // (rules/frontend.md mục 2), thay vì dùng `useSearchParams()`. Header không truyền ⇒ hành vi cũ.
  query?: Record<string, string>;
}

// Chuyển đổi vi/en cho trang hiện tại. Link truyền `locale` tường minh (thay
// vì tự suy ra từ URL có/không prefix) — đúng cơ chế đã xác nhận ở Bước 4.5:
// muốn chuyển VỀ locale mặc định (vi) cũng phải link tường minh "/vi/...",
// next-intl mới tự rút gọn URL về dạng không prefix.
// Không tự định vị "fixed" — được ghép trực tiếp vào Header
// (shared/components/Header.tsx) và vào AuthPageLayout (các trang xác thực không có Header), nơi ghép quyết
// định vị trí.
export function LocaleSwitcher({ query }: LocaleSwitcherProps) {
  const pathname = usePathname();
  const activeLocale = useLocale();
  const href = query && Object.keys(query).length > 0 ? { pathname, query } : pathname;

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-sm">
      {routing.locales.map((locale) => (
        <Button
          key={locale}
          type="button"
          variant={locale === activeLocale ? 'default' : 'ghost'}
          size="sm"
          nativeButton={false}
          render={<Link href={href} locale={locale} />}
        >
          {LOCALE_LABELS[locale]}
        </Button>
      ))}
    </div>
  );
}
