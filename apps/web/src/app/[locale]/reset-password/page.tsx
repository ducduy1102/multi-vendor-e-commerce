import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { ResetPasswordFormContainer } from '@/modules/auth';
import { AuthPageLayout } from '@/shared/components/AuthPageLayout';
import { ChotMark } from '@/shared/components/ChotMark';

// Token đặt lại mật khẩu nằm trong query string của URL này: `no-referrer` để tài nguyên/liên kết ngoài tải
// từ trang không nhận được URL đầy đủ (kèm token) qua header Referer; `noindex` để không bị lập chỉ mục.
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  // Đọc 1 lần lúc render (Server Component), không dùng useSearchParams() (rules/frontend.md mục 2).
  const [{ token }, t, tHeader] = await Promise.all([
    searchParams,
    getTranslations('auth'),
    getTranslations('header'),
  ]);

  return (
    <AuthPageLayout localeQuery={typeof token === 'string' ? { token } : undefined}>
      <Link href="/" className="mb-6 flex items-center justify-center gap-1.5">
        <ChotMark className="size-7 shrink-0" />
        <span className="font-semibold text-brand">{tHeader('siteName')}</span>
      </Link>
      <h1 className="mb-6 text-xl font-semibold">{t('resetPasswordTitle')}</h1>
      <ResetPasswordFormContainer token={typeof token === 'string' ? token : null} />
    </AuthPageLayout>
  );
}
